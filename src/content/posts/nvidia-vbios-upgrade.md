---
title: 服务器上升级 NVIDIA VBIOS
description: 在 A800 节点上用 nvflash 升级 VBIOS 的步骤：解除 K8s / Docker / 驱动占用，关闭 IPMI 写保护，逐卡备份后刷入，再恢复服务并核对 BIOS 版本。
excerpt: 刷 VBIOS 前必须卸掉 nvidia 相关模块，并确认 IPMI 写保护已关。每张卡单独备份，再按 index 逐张刷入。
pubDate: 2026-08-30
category: tech
tags: ['NVIDIA', 'VBIOS', 'GPU', 'HPC']
---

本次在一台 A800 服务器上升级 NVIDIA VBIOS。刷写文件为 `g506.nvr`。开始前确认文件正确，并且机器上没有正在运行的用户程序。

## 工具

内部包为 `vbios.tar.gz`，解压后进入目录：

```bash
# wget http://sssh.hpc.pub/vbios.tar.gz
tar -xvf vbios.tar.gz
cd vbios
```

后续命令均在该目录下执行。

## 解除占用

驱动模块被占用时无法卸载，刷写也会失败。按实际环境停相关服务，没有的可以跳过。

暂停 Kubernetes：

```bash
# 暂停 k8s pods；若卡住过久，可等约 20 秒后 Ctrl+C
systemctl stop kubelet
systemctl stop kubepods-*
```

若 Docker 配置了 NVIDIA runtime，先备份再停 Docker：

```bash
cat /etc/docker/daemon.json | grep -v "nvidia"

# 存在 nvidia-docker-runtime 相关配置时
mv /etc/docker/daemon.json /etc/docker/daemon.json.bak
systemctl stop docker
```

停止 NVIDIA 相关服务：

```bash
systemctl stop nvidia-fabricmanager
systemctl stop nvidia-persistenced
```

## 卸载驱动模块

反复执行，直到提示相关模块均未加载。本环境通常为 5 个：

```bash
rmmod nvidia_drm nvidia_modeset nvidia_peermem nvidia_uvm nvidia
```

仍有占用时，查进程后结束：

```bash
lsof -w /dev/nvidia*
kill -9 <PID>
```

## 核对版本、关写保护、备份

列出设备并核对 Board 标识。本次 A800 在服务器上的标识为 `20F3`，其他卡一并核对：

```bash
./nvflash --list
./nvflash --version | grep 20F3
```

关闭 IPMI 写保护：

```bash
bash guanbi_ipmi.sh
```

每张卡单独备份：

```bash
./nvflash --index=0 --save gpu0.bak.rom
# ./nvflash --index=1 --save gpu1.bak.rom
# ...
```

## 逐卡刷入

按 `--index` 递增，每张卡执行一次：

```bash
./nvflash --index=0 g506.nvr
# ./nvflash --index=1 g506.nvr
# ...
```

全部刷完后再打开 IPMI 写保护：

```bash
bash kaiqi_ipmi.sh
```

若之前改过 Docker 配置，还原：

```bash
cp /etc/docker/daemon.json.bak /etc/docker/daemon.json
```

重启后检查容器、kubelet，以及 BIOS 版本：

```bash
reboot

docker ps
systemctl status kubelet
nvidia-smi -q | grep -i bios
```
