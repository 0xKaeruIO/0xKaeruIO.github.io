---
title: Slurm 作业脚本实战：资源申请、数组作业与依赖链
description: sbatch 脚本里每一个参数的实际含义，以及如何用作业数组做参数扫描、用依赖链串起多阶段流水线，附一份可以直接抄的模板。
excerpt: 大部分排队时间过长的作业，问题不在集群忙，而在资源申请写得太随意。
pubDate: 2026-06-03
category: tech
tags: ['Slurm', 'HPC', '作业调度', 'Shell']
---

集群用久了会发现一个规律：抱怨"作业排队太久"的人，脚本里往往写着 `--time=7-00:00:00` 和 `--mem=0`。

调度器不会读心。你申请多少，它就按多少去找空隙——申请得越宽松，能塞进去的空隙就越少。这篇讲清楚每个参数的实际后果，以及三种真正提升吞吐的写法。

## 一份可以直接抄的模板

```bash
#!/bin/bash
#SBATCH --job-name=matmul
#SBATCH --partition=compute
#SBATCH --nodes=1
#SBATCH --ntasks-per-node=1
#SBATCH --cpus-per-task=16
#SBATCH --mem=32G
#SBATCH --time=02:00:00
#SBATCH --output=logs/%x-%j.out
#SBATCH --error=logs/%x-%j.err
#SBATCH --mail-type=END,FAIL
#SBATCH --mail-user=me@example.com

set -euo pipefail

# 让线程库和 Slurm 的 CPU 分配保持一致，否则会超额开线程互相抢核
export OMP_NUM_THREADS="${SLURM_CPUS_PER_TASK}"
export MKL_NUM_THREADS="${SLURM_CPUS_PER_TASK}"

module purge
module load python/3.12 openmpi/5.0

echo "作业 ${SLURM_JOB_ID} 于 $(date '+%F %T') 在 ${SLURMD_NODENAME} 启动"

srun python -u train.py --workers "${SLURM_CPUS_PER_TASK}"

echo "作业结束于 $(date '+%F %T')"
```

几个细节值得单独说：

- **`set -euo pipefail`**：没有它，脚本中间某步失败仍会以 exit 0 结束，作业记录里是 `COMPLETED`，你要到查数据时才发现结果是空的。
- **`%x-%j`**：`%x` 是作业名，`%j` 是作业号。用固定文件名会让并发作业互相覆盖日志。`logs/` 目录必须提前建好，Slurm 不会自动创建，路径不存在会让作业直接失败。
- **`OMP_NUM_THREADS`**：NumPy/PyTorch 默认按物理核数开线程。申请 16 核却开 64 线程，性能反而比串行还差。
- **`python -u`**：关掉输出缓冲，否则作业被 kill 时日志里什么都没有。

## 资源申请的四个参数

`--nodes`、`--ntasks`、`--cpus-per-task`、`--mem` 的组合关系是最容易搞混的地方。用一句话概括：**task 是进程，cpus-per-task 是每个进程的线程数。**

```bash
# 单机多线程（OpenMP / PyTorch DataLoader）
#SBATCH --nodes=1 --ntasks=1 --cpus-per-task=32

# 跨节点 MPI，每节点 8 个 rank，每 rank 单线程
#SBATCH --nodes=4 --ntasks-per-node=8 --cpus-per-task=1

# MPI + OpenMP 混合：每节点 2 个 rank，每 rank 16 线程
#SBATCH --nodes=4 --ntasks-per-node=2 --cpus-per-task=16
```

内存有两种写法，含义完全不同：

```bash
#SBATCH --mem=64G              # 每节点 64G
#SBATCH --mem-per-cpu=4G       # 每核 4G，实际总量 = 核数 × 4G
```

配了 `ConstrainRAMSpace=yes` 的集群上，超出申请量会被 OOM Killer 直接杀掉，日志里留下 `slurmstepd: error: Detected 1 oom-kill event`。

至于 `--time`：**填真实预估的 1.5 倍**。这不是节省资源的道德问题，而是 backfill 调度器需要知道时长才能把你的作业塞进大作业之间的空隙。把 2 小时的作业申请成 7 天，只会让自己一直排在队尾。

## 作业数组：参数扫描的正确姿势

要跑 100 组超参数，写 100 个脚本或者 for 循环提交 100 次都是错的。用数组：

```bash
#!/bin/bash
#SBATCH --job-name=sweep
#SBATCH --array=0-99%10        # 100 个任务，最多 10 个同时跑
#SBATCH --cpus-per-task=4
#SBATCH --mem=8G
#SBATCH --time=00:30:00
#SBATCH --output=logs/%x-%A_%a.out

set -euo pipefail

LR_LIST=(0.001 0.003 0.01 0.03 0.1)
BS_LIST=(16 32 64 128)

# 用任务号解出这一组的参数组合
lr="${LR_LIST[$(( SLURM_ARRAY_TASK_ID % ${#LR_LIST[@]} ))]}"
bs="${BS_LIST[$(( SLURM_ARRAY_TASK_ID / ${#LR_LIST[@]} % ${#BS_LIST[@]} ))]}"

echo "任务 ${SLURM_ARRAY_TASK_ID}: lr=${lr} bs=${bs}"
srun python train.py --lr "$lr" --batch-size "$bs" \
  --out "results/run_${SLURM_ARRAY_TASK_ID}.json"
```

数组作业的三个关键点：

- **`%10` 是并发上限**，加上它才不会一口气占满整个分区被同事投诉。
- **`%A_%a`** 分别是数组主作业号和任务号，`%j` 在数组里没有区分度。
- **单个任务失败可以单独重投**：`scontrol requeue 12345_7`，不必重跑整个数组。

从文件读参数列表比手写数组更实用：

```bash
#SBATCH --array=1-500%20
params=$(sed -n "${SLURM_ARRAY_TASK_ID}p" params.txt)
srun python run.py $params
```

## 依赖链：串起多阶段流水线

预处理 → 训练 → 汇总，三个阶段必须按序执行。不要用 `sleep` 轮询，用 `--dependency`：

```bash
#!/bin/bash
set -euo pipefail

prep=$(sbatch --parsable prep.sbatch)
echo "预处理: $prep"

# afterok 表示前一步成功结束才启动
train=$(sbatch --parsable --dependency="afterok:${prep}" train.sbatch)
echo "训练: $train"

# aftercorr：数组任务逐一对应，任务 N 完成就启动下游任务 N
post=$(sbatch --parsable --dependency="aftercorr:${train}" post.sbatch)
echo "汇总: $post"
```

`--parsable` 让 `sbatch` 只输出作业号，省掉 `awk` 切分。可用的依赖类型：

| 类型 | 触发条件 |
| --- | --- |
| `afterok` | 前置作业**成功**结束（最常用） |
| `afterany` | 前置作业结束，无论成败（适合清理步骤） |
| `afternotok` | 前置作业失败（适合失败告警） |
| `aftercorr` | 数组任务一一对应触发 |
| `singleton` | 同名作业串行执行，防止重复运行 |

依赖不满足时作业会停在 `DependencyNeverSatisfied` 状态并**永久挂着**，记得给流水线配 `--kill-on-invalid-dep=yes`。

## 提交之后：几个高频命令

```bash
# 我的队列，看 ST 和 NODELIST(REASON)
squeue -u "$USER" -o "%.10i %.20j %.8T %.10M %.6D %R"

# 排队作业的预计启动时间——比反复刷 squeue 有用得多
squeue -u "$USER" --start

# 为什么没跑起来
scontrol show job 12345 | grep -E 'JobState|Reason|TRES'

# 实时看正在跑的作业占了多少资源
sstat -j 12345 --format=JobID,AveCPU,MaxRSS,MaxVMSize

# 复盘已结束的作业：申请了多少、实际用了多少
sacct -j 12345 --format=JobID,JobName,State,Elapsed,ReqMem,MaxRSS,ReqCPUS,TotalCPU
```

## 小结

写作业脚本的核心是**诚实**：如实申请资源，调度器就能高效地安排你。数组作业和依赖链则把手工重复劳动交还给调度器，这两个特性用熟之后，"提交一批实验"从半小时的机械操作变成一行命令。

下一篇讲 GPU：`gres` 怎么配、`CUDA_VISIBLE_DEVICES` 是怎么被注入的、以及多卡作业的绑定策略。
