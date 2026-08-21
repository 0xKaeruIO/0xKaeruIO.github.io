---
title: 从零搭建一套可用的 Slurm 集群
description: 从 Munge 认证、slurm.conf 到 slurmdbd 与 cgroup 隔离，完整梳理一套小规模 Slurm 集群从裸机到能跑第一个作业的全过程，以及那些文档里不会明说的坑。
excerpt: 三台机器、一个共享目录、一份 slurm.conf——把调度器真正跑起来需要的东西比想象中少，但每一步都不能糊弄。
pubDate: 2026-05-12
category: tech
tags: ['Slurm', 'HPC', '集群运维', 'Linux']
featured: true
---

第一次独立搭 Slurm 的时候，我在 `slurmd: error: Unable to establish control machine address` 上卡了整个下午。最后发现是计算节点的 `/etc/hosts` 少写了一行。

Slurm 本身并不复杂，它的复杂度几乎全部来自"环境必须一致"这个前提。这篇把一套三节点集群从裸机到跑通第一个作业的过程完整记录下来，顺带标注每一步真正容易出错的地方。

## 角色划分

一套最小可用的集群需要三种角色，小规模下完全可以合并到同一台物理机上：

| 角色 | 组件 | 说明 |
| --- | --- | --- |
| 控制节点 | `slurmctld` | 调度决策与状态机，全局唯一（可配主备） |
| 计算节点 | `slurmd` | 拉起作业进程、上报资源、执行 cgroup 约束 |
| 记账节点 | `slurmdbd` + MySQL | 作业历史、公平共享、QoS 的数据来源 |

本文的拓扑：`ctl01` 兼任控制与记账，`node01`、`node02` 为计算节点。

## 前置条件：先把地基铺平

这一节比后面所有配置加起来都重要。90% 的"Slurm 起不来"最终都能归因到这四件事。

**1. 主机名解析必须双向可达。** 每个节点的 `/etc/hosts` 都要能解析集群里所有节点，包括自己：

```bash
cat >> /etc/hosts <<'EOF'
10.0.0.10  ctl01
10.0.0.11  node01
10.0.0.12  node02
EOF

# 逐台验证，一台都不能漏
for h in ctl01 node01 node02; do
  getent hosts "$h" || echo "!! $h 解析失败"
done
```

注意 Slurm 用 `NodeName` 去做反向匹配，如果 `hostname -s` 的输出和 `slurm.conf` 里的 `NodeName` 不一致，节点会一直停在 `UNKNOWN` 状态。

**2. UID/GID 必须全集群一致。** 作业在计算节点上以提交用户的身份运行，UID 不一致会直接导致文件权限混乱。生产环境用 LDAP/SSSD，测试环境至少手动对齐：

```bash
# 所有节点上 slurm 用户的 uid 必须相同
useradd -r -u 981 -s /sbin/nologin slurm
```

**3. 时间必须同步。** Munge 的凭据带时间戳，默认容忍窗口只有 5 分钟。偏差超限的表现是 `Munge decode failed: Rewound credential`，非常具有误导性。

```bash
timedatectl set-timezone Asia/Shanghai
systemctl enable --now chronyd
chronyc sources -v   # 确认 ^* 出现在某个源前面
```

**4. 需要一个共享文件系统。** 作业脚本、输入数据、输出日志都得让所有节点看到同一份。小集群用 NFS 足够：

```bash
# ctl01 导出
echo "/shared 10.0.0.0/24(rw,sync,no_root_squash)" >> /etc/exports
exportfs -ra

# 计算节点挂载
mount -t nfs ctl01:/shared /shared
```

## Munge：集群内的身份认证

Slurm 各守护进程之间用 Munge 互认，原理是一把所有节点共享的对称密钥。

```bash
# 只在控制节点生成一次
/usr/sbin/create-munge-key -r
chown munge:munge /etc/munge/munge.key
chmod 400 /etc/munge/munge.key

# 分发到每个计算节点，权限不能错
for n in node01 node02; do
  scp /etc/munge/munge.key "$n:/etc/munge/munge.key"
  ssh "$n" 'chown munge:munge /etc/munge/munge.key && \
            chmod 400 /etc/munge/munge.key && \
            systemctl enable --now munge'
done
```

验证跨节点认证，这一步通过了后面才有意义：

```bash
munge -n | ssh node01 unmunge | grep STATUS
# STATUS: Success (0)
```

> 权限是这里唯一的坑：`munge.key` 必须是 `400 munge:munge`，`/etc/munge` 必须是 `700`。Munge 会静默拒绝权限过宽的密钥，日志里只留一行含糊的 "Failed to access"。

## slurm.conf：一份能直接用的配置

这份配置文件必须在所有节点上完全一致。放在 `/shared/slurm/slurm.conf` 再软链过去，可以省掉大量同步的麻烦。

```ini
ClusterName=lab
SlurmctldHost=ctl01
SlurmUser=slurm
StateSaveLocation=/var/spool/slurmctld
SlurmdSpoolDir=/var/spool/slurmd
SlurmctldPidFile=/run/slurmctld.pid
SlurmdPidFile=/run/slurmd.pid

# 调度：cons_tres 支持按核心/GPU 细粒度分配，是现在的默认选择
SelectType=select/cons_tres
SelectTypeParameters=CR_Core_Memory
SchedulerType=sched/backfill

# 资源约束：把作业关进 cgroup，防止越用内存和 CPU
ProctrackType=proctrack/cgroup
TaskPlugin=task/cgroup,task/affinity

# 记账
AccountingStorageType=accounting_storage/slurmdbd
AccountingStorageHost=ctl01
JobAcctGatherType=jobacct_gather/cgroup
JobAcctGatherFrequency=30

# 超时与重试
SlurmctldTimeout=120
SlurmdTimeout=300
InactiveLimit=0
MinJobAge=300
KillWait=30

# 节点与分区
NodeName=node[01-02] CPUs=64 Sockets=2 CoresPerSocket=16 ThreadsPerCore=2 \
         RealMemory=257000 State=UNKNOWN
PartitionName=compute Nodes=node[01-02] Default=YES MaxTime=7-00:00:00 State=UP
PartitionName=debug   Nodes=node[01-02] MaxTime=00:30:00 State=UP \
         MaxNodes=1 Priority=100
```

几个必须解释的选择：

- **`RealMemory` 一定要略小于实际物理内存。** 直接照抄 `free -m` 的总量，节点会因为操作系统自身占用而被判定为内存不足，进而 drain。用 `slurmd -C` 打印探测值，然后减去 1~2 GB。
- **`CR_Core_Memory` 让内存成为可调度资源。** 不加 `_Memory`，用户申请的 `--mem` 会被忽略，一个内存泄漏的作业就能把整个节点拖死。
- **`State=UNKNOWN`** 是初次配置的推荐值，让 `slurmd` 上报真实状态，而不是强行声明。

配置写完先做语法自检：

```bash
slurmd -C                      # 打印本机真实硬件拓扑，用来核对 NodeName 行
scontrol show config | head    # 解析成功才会有输出
```

## cgroup 配置

`cgroup.conf` 决定约束的严格程度，同样需要全节点一致：

```ini
CgroupPlugin=autodetect
ConstrainCores=yes
ConstrainRAMSpace=yes
ConstrainSwapSpace=yes
ConstrainDevices=yes
AllowedRAMSpace=100
AllowedSwapSpace=0
```

`ConstrainDevices=yes` 是 GPU 隔离的前提——没有它，作业能看到节点上所有显卡，`--gres=gpu:1` 形同虚设。这部分我在[另一篇](/posts/slurm-gpu-gres-scheduling)里单独展开。

确认内核跑的是 cgroup v2，现在的发行版基本都是：

```bash
stat -fc %T /sys/fs/cgroup   # cgroup2fs
```

## slurmdbd：让作业历史可查

没有记账数据库，`sacct` 查不到任何历史，公平共享和 QoS 也无从谈起。

```sql
CREATE DATABASE slurm_acct_db;
CREATE USER 'slurm'@'localhost' IDENTIFIED BY '<强密码>';
GRANT ALL ON slurm_acct_db.* TO 'slurm'@'localhost';
FLUSH PRIVILEGES;
```

`slurmdbd.conf` 含明文密码，权限必须收紧到 `600 slurm:slurm`：

```ini
DbdHost=ctl01
SlurmUser=slurm
StorageType=accounting_storage/mysql
StorageHost=localhost
StorageUser=slurm
StoragePass=<强密码>
StorageLoc=slurm_acct_db
PurgeJobAfter=12months
PurgeStepAfter=6months
```

`PurgeJobAfter` 值得一开始就设好。见过一套集群三年没清理，作业表涨到几千万行，`sacct` 一次查询要等两分钟。

## 启动顺序

顺序错了会得到一堆无意义的报错，按这个来：

```bash
# ctl01
systemctl enable --now munge slurmdbd
sleep 5                                  # 等 slurmdbd 建完表
systemctl enable --now slurmctld

# 计算节点
for n in node01 node02; do
  ssh "$n" 'systemctl enable --now munge slurmd'
done
```

注册集群到记账库，这一步容易被漏掉：

```bash
sacctmgr add cluster lab
sacctmgr add account research Description="研究组"
sacctmgr add user ricedev Account=research
```

## 验证

```bash
sinfo -Nl
# NODELIST  S:C:T   MEMORY  STATE
# node01    2:16:2  257000  idle
# node02    2:16:2  257000  idle
```

节点是 `idle` 就成功了。跑第一个作业：

```bash
srun -N2 --ntasks-per-node=2 hostname
# node01
# node01
# node02
# node02
```

再确认记账链路通了：

```bash
sacct -X --format=JobID,JobName,State,Elapsed
```

`sacct` 能出结果，说明 `slurmctld → slurmdbd → MySQL` 整条链路都是活的。

## 排障速查

节点状态不对时，按这个顺序查，命中率很高：

```bash
# 1. 看 Slurm 自己怎么解释
scontrol show node node01 | grep -E 'State|Reason'

# 2. drain 的节点手动恢复（先解决 Reason 再恢复）
scontrol update NodeName=node01 State=RESUME

# 3. 三个日志按角色分开看
tail -f /var/log/slurm/slurmctld.log   # 调度决策
tail -f /var/log/slurm/slurmd.log      # 节点侧执行
tail -f /var/log/slurm/slurmdbd.log    # 记账
```

几个高频状态的含义：

- `down` + `Reason=Not responding`：网络或 `slurmd` 挂了，先 `systemctl status slurmd`
- `drain` + `Reason=Low RealMemory`：`slurm.conf` 里的 `RealMemory` 写大了
- `unk`：`slurmd` 从没成功注册过，查 Munge 和主机名解析
- 一切正常但作业 `PD` 且 `Reason=Resources`：真的没资源了，`squeue --start` 看预计启动时间

## 小结

回头看，真正需要动脑的只有 `slurm.conf` 里的调度策略；剩下的工作量全在"保证所有节点看到一致的世界"上。搭第二套集群的时候我把前置检查写成了一个脚本，从半天缩短到二十分钟——**能自动化的一致性检查，一定要自动化**。

下一篇写作业脚本本身：怎么申请资源、怎么用数组作业批量跑参数扫描、怎么串依赖链。
