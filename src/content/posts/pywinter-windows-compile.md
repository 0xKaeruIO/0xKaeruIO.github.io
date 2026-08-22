---
title: Windows 上编译 pywinter
description: Windows 上通过 pip 安装的 pywinter 可能未编译 Fortran 扩展。本文记录 AttributeError、vcvarsall.bat 找不到，以及 pyd 依赖的 gfortran DLL 放置方式。
excerpt: pip 安装后 KreatE_inter_m_f 为空目录，缺少 crear_int0。需要自行编译 f90，并将 gfortran DLL 放到 site-packages。
pubDate: 2026-08-23
category: tech
tags: ['pywinter', 'WRF']
---

在 Windows 上使用 [pywinter](https://github.com/dniloash/Pywinter) 生成 WRF 中间文件时，调用插值接口报错：

```text
AttributeError: module 'KreatE_inter_m_f' has no attribute 'crear_int0'
```

一种可能是接口更名。查看源码与安装结果后，实际原因是：pip 安装的扩展没有被编译。

## 现象与核对

调用位置如下（约第 188 行）：

```python
import KreatE_inter_m_f as creattee_inter

creattee_inter.crear_int0(
    startlat, startlon, deltalat, deltalon,
    fnt, fci, fun, fds, flv, ns, va,
)
```

`crear_int0` 由 Fortran 源文件经 f2py 导出。用 PyCharm 打开 `KreatE_inter_m_f`，该路径是空目录：没有 `.pyd`，也没有其他编译产物。模块名存在，属性不存在，因此触发 `has no attribute`。

上游仓库注明该文件需要先编译：

```bash
f2py -c KreatE_inter_m_f.f90 -m KreatE_inter_m_f
```

`setup.py` 将其注册为扩展模块：

```python
ext1 = Extension(
    name='KreatE_inter_m_f',
    sources=['pywinter/KreatE_inter_m_f.f90'],
)

setup(name='pywinter', ...)
```

安装目录中没有对应产物，因此判断 **pip 安装时未编译 `KreatE_inter_m_f.f90`**。处理方式是从 GitHub 获取源码，在本机编译。

## 编译报错：找不到 vcvarsall.bat

自行编译时，f2py / distutils 通过 `vcvarsall.bat` 初始化 MSVC 工具链。若提示找不到该文件，按下列顺序检查：

1. 确认已安装 MSVC。未安装时，按微软文档安装 Visual Studio Build Tools，并勾选 C++ 桌面开发相关工作负载。
2. 已安装但仍找不到文件时，在 VS 安装目录中搜索 `vcvarsall.bat`。常见路径示例：

   ```text
   C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvarsall.bat
   ```

3. 文件存在仍无法编译时，多半是 distutils 的查找路径与本机安装位置不一致。可修改 `msvc9compiler.py`（文件名随 Python / setuptools 版本可能不同）中的 `find_vcvarsall(version)`，使其直接返回 `vcvarsall.bat` 的绝对路径。

修改后再执行 `f2py` 或 `pip install .`。编译成功后，当前 Python 环境的 `site-packages` 中会出现一个目录，以及 `KreatE_inter_m_f*.pyd`。

## 编译成功后的 ImportError

编译完成后再次运行，可能出现：

```text
ImportError: DLL load failed while importing KreatE_inter_m_f: 找不到指定的模块。
```

在 PyCharm 中下断点可以看到：此时已经成功引用 `.pyd`。缺少的是 pyd 所依赖的 gfortran 运行库，而不是 pyd 本身。

编译产物旁有 `KreatE_inter_m_f\.libs\`。用编辑器打开 pyd，二进制中仍可检索到字符串，其中包含类似：

```text
libKreatE_i.V7GIA3AAYD7NAFOHH27DAZ5A5IGCGGN7.gfortran-win_amd64.dll
```

中间哈希段每次编译会变化，不要写死文件名，到 `.libs` 中取当前生成的那一份。

将这份 DLL **复制到 `site-packages` 根目录**，与 `.pyd` 同级。Windows 加载扩展模块时，默认在模块所在目录查找依赖 DLL，不会进入 `.libs` 子目录。Linux 上对应做法是将 so 放到 `/usr/lib`，或加入 `LD_LIBRARY_PATH`。

完成后再调用 `crear_int0`。

## 小结

Windows 上 pip 安装的 pywinter 可能只有源码目录，没有编译后的扩展。处理分三步：

1. 确认 `KreatE_inter_m_f` 为空目录，排除接口更名。
2. 使用 MSVC 编译 `KreatE_inter_m_f.f90`。找不到 `vcvarsall.bat` 时，改为返回其绝对路径。
3. 将 `.libs` 中的 gfortran DLL 放到 `site-packages`，与 pyd 同级。

前两步对应「模块无属性」，第三步对应「模块已加载、依赖 DLL 未找到」。
