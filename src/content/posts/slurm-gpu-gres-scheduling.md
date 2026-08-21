---
title: Slurm 的 GPU 调度：gres 配置与设备隔离
description: 从 gres.conf 的写法到 CUDA_VISIBLE_DEVICES 的注入机制，讲清楚 Slurm 如何把显卡分配给作业，以及多卡训练时 NUMA 亲和性带来的实际性能差异。
excerpt: 作业里 nvidia-smi 能看到全部八张卡，几乎总是同一个原因——cgroup 的设备约束没打开。
pubDate: 2026-07-08
category: tech
tags: ['Slurm', 'GPU', 'HPC', 'CUDA']
featured: true
---

GPU 节点上线第一周，我收到一个报障：用户申请了 1 张卡，但 `nvidia-smi` 里八张卡全都在。他很好心地提醒我"是不是配错了"——确实配错了，`cgroup.conf` 里少了一行 `ConstrainDevices=yes`。

Slurm 的 GPU 调度分两层：**分配**决定谁拿到哪张卡，**隔离**保证拿不到的看不见。两层各有各的配置，缺一层就等于没配。

## gres.conf：告诉 Slurm 有哪些卡

`gres.conf` 放在每个 GPU 节点上，描述本机的设备清单：

```ini
# /etc/slurm/gres.conf
AutoDetect=nvml

Name=gpu Type=a100 File=/dev/nvidia[0-7] Cores=0-31,32-63
```

`AutoDetect=nvml` 是现在的推荐做法——Slurm 通过 NVML 库自动探测型号、设备文件和 NUMA 拓扑，比手写省事且不容易错。前提是编译时带了 NVML 支持，确认一下：

```bash
slurmd -C                          # 输出里应包含 Gres=gpu:a100:8
scontrol show node gpu01 | grep -i gres
# Gres=gpu:a100:8(S:0-1)
```

如果输出里 `Gres=(null)`，说明 `slurmd` 没编 NVML，只能手写 `File=` 和 `Cores=`。

对应的 `slurm.conf` 需要声明 GRES 类型，并把 GPU 计入可追踪资源：

```ini
GresTypes=gpu
AccountingStorageTRES=gres/gpu,gres/gpu:a100

NodeName=gpu[01-04] CPUs=64 Sockets=2 CoresPerSocket=16 ThreadsPerCore=2 \
         RealMemory=515000 Gres=gpu:a100:8 State=UNKNOWN

PartitionName=gpu Nodes=gpu[01-04] Default=NO MaxTime=3-00:00:00 State=UP
```

漏掉 `AccountingStorageTRES` 的后果是 `sacct` 查不到 GPU 使用量，也就没法按卡时做配额和计费。

## 设备隔离：那行关键的配置

分配是 `slurm.conf` 的事，隔离是 `cgroup.conf` 的事：

```ini
# /etc/slurm/cgroup.conf
ConstrainDevices=yes
ConstrainCores=yes
ConstrainRAMSpace=yes
```

`ConstrainDevices=yes` 让 `slurmstepd` 在 cgroup 的设备控制器里只放行分配到的 `/dev/nvidiaN`。没有它，`CUDA_VISIBLE_DEVICES` 只是一个用户可以随手 `unset` 的环境变量——不是隔离，只是建议。

改完必须重启计算节点的 `slurmd`：

```bash
scontrol reconfigure                     # 只重载 slurm.conf，不含 cgroup.conf
systemctl restart slurmd                 # cgroup.conf 的变更需要这个
```

这是个反复踩的坑：`scontrol reconfigure` 不会重载 `cgroup.conf`。

验证隔离是否真的生效：

```bash
srun -p gpu --gres=gpu:1 --pty bash -c 'nvidia-smi -L; echo "CVD=$CUDA_VISIBLE_DEVICES"'
# GPU 0: NVIDIA A100-SXM4-80GB (UUID: GPU-xxxx)
# CVD=0
```

只列出一张卡才算对。列出八张就回去检查 `ConstrainDevices`。

## CUDA_VISIBLE_DEVICES 的注入逻辑

这里有个几乎所有人都会踩一次的语义陷阱。Slurm 注入的 `CUDA_VISIBLE_DEVICES` 是**相对于本作业的重新编号**，永远从 0 开始。

假如作业分到了节点上物理编号 3 和 5 的两张卡，作业内看到的是：

```bash
CUDA_VISIBLE_DEVICES=0,1
```

所以**作业脚本里绝对不要手动设置 `CUDA_VISIBLE_DEVICES`**。这样写会直接把分配打乱：

```bash
# 错误：覆盖了 Slurm 的分配，可能指向没分配给你的卡
export CUDA_VISIBLE_DEVICES=0,1,2,3
python train.py
```

要知道实际拿到的物理卡，查作业信息而不是环境变量：

```bash
scontrol show job "$SLURM_JOB_ID" | grep -i gres
# GRES=gpu:a100:2(IDX:3,5)
```

## 单卡与多卡作业

单卡训练：

```bash
#!/bin/bash
#SBATCH --partition=gpu
#SBATCH --gres=gpu:a100:1
#SBATCH --cpus-per-task=8
#SBATCH --mem=64G
#SBATCH --time=12:00:00
#SBATCH --output=logs/%x-%j.out

set -euo pipefail
module load cuda/12.4 python/3.12

nvidia-smi --query-gpu=index,name,memory.total --format=csv
srun python -u train.py
```

单机多卡的 DDP，用 `torchrun` 管理进程更省事：

```bash
#SBATCH --nodes=1
#SBATCH --gres=gpu:a100:4
#SBATCH --cpus-per-task=32
#SBATCH --mem=256G

set -euo pipefail
export OMP_NUM_THREADS=8       # 32 核 / 4 进程

torchrun --standalone --nproc_per_node=4 train_ddp.py
```

跨节点多卡稍微麻烦，需要自己拼出 rendezvous 地址：

```bash
#SBATCH --nodes=2
#SBATCH --ntasks-per-node=1
#SBATCH --gres=gpu:a100:8
#SBATCH --cpus-per-task=64

set -euo pipefail

MASTER_ADDR=$(scontrol show hostnames "$SLURM_JOB_NODELIST" | head -n1)
export MASTER_ADDR
export MASTER_PORT=29500

srun torchrun \
  --nnodes="$SLURM_NNODES" \
  --nproc_per_node=8 \
  --node_rank="$SLURM_NODEID" \
  --rdzv_backend=c10d \
  --rdzv_endpoint="${MASTER_ADDR}:${MASTER_PORT}" \
  train_ddp.py
```

`MASTER_PORT` 固定值在同节点跑两个多机作业时会冲突。用作业号派生一个更稳妥：

```bash
export MASTER_PORT=$(( 20000 + SLURM_JOB_ID % 10000 ))
```

## NUMA 亲和性：一行配置换来的真实收益

GPU 挂在特定的 PCIe 根桥下，跨 socket 访问要绕一次 UPI。这不是理论上的差异——在我们的 A100 节点上，数据加载密集的任务因为亲和性没配对，吞吐差了约 15%。

先看拓扑：

```bash
nvidia-smi topo -m
#         GPU0  GPU1  GPU2  GPU3  CPU Affinity  NUMA Affinity
# GPU0     X    NV12  NV12  NV12  0-15,64-79    0
# GPU2   NV12   NV12   X    NV12  16-31,80-95   1
```

`AutoDetect=nvml` 会自动读出这个映射，剩下的交给绑定选项：

```bash
srun --gres=gpu:2 --cpu-bind=verbose,cores --gpu-bind=closest python train.py
```

`--cpu-bind=verbose` 会打印实际绑定结果，调试时很有用。`--gpu-bind=closest` 让每个 task 绑到拓扑上最近的卡。

## 排障速查

```bash
# 作业排队中，确认是不是真没卡了
sinfo -p gpu -o "%n %G %t"
scontrol show node gpu01 | grep -E 'Gres|AllocTRES'

# 谁在占卡
squeue -p gpu -o "%.10i %.10u %.8T %.20b %R"

# 复盘作业实际申请的 GPU
sacct -j 12345 --format=JobID,AllocTRES%40,Elapsed,State
```

几个高频症状：

- **`Requested node configuration is not available`**：`--gres` 里的 Type 拼错了。集群上是 `a100`，写 `A100` 或 `a100-80gb` 都会匹配失败，用 `sinfo -o "%G"` 确认准确写法。
- **作业能起来但 `torch.cuda.is_available()` 为 False**：驱动与 CUDA 运行时版本不匹配，或者作业没有 `--gres` 就直接跑（此时 `CUDA_VISIBLE_DEVICES` 被设为空字符串，这是正常的隔离行为）。
- **节点 drain 且 `Reason=gres/gpu count too low`**：有卡掉了。`nvidia-smi` 看是否少了设备，通常是 Xid 错误或者驱动需要重载。
- **多机 DDP 卡在初始化**：`MASTER_ADDR` 解析不到，或者 NCCL 选错网卡。加 `export NCCL_DEBUG=INFO` 看它选了哪个 interface，必要时用 `NCCL_SOCKET_IFNAME=ib0` 强制指定。

## 小结

GPU 调度真正需要记住的只有三件事：`AutoDetect=nvml` 省掉手写拓扑、`ConstrainDevices=yes` 才叫隔离、`CUDA_VISIBLE_DEVICES` 是作业内的相对编号不要碰。剩下的性能调优——NUMA 绑定、NCCL 网卡选择——都属于确认完正确性之后再做的事。
