# 0xKaeruIO.github.io

个人博客与主页，线上地址 <https://0xkaeruio.github.io>。技术笔记（HPC / Slurm / 系统工程）、生活随笔，以及自动同步的 GitHub 活跃数据。

**设计风格**：温简主义（Warm Minimalism）× 现代复古（Modern Vintage）。配色取自主题插画的奶油纸、朱红、藏青、青绿与蜜金，标题带套色偏移的复古印刷质感。

## 技术栈

| 组成 | 选择 | 说明 |
| --- | --- | --- |
| 框架 | [Astro](https://astro.build) 7 | 纯静态输出，零客户端 JS（除主题切换与目录高亮） |
| 内容 | Markdown + Content Collections | 带类型校验的 frontmatter |
| 样式 | 原生 CSS（自定义属性） | 无 CSS 框架，设计 token 集中在 `src/styles/global.css` |
| 字体 | Fraunces / Inter / JetBrains Mono | 自托管，中文走系统字体回退 |
| 部署 | GitHub Actions → GitHub Pages | 推送即部署，每日定时刷新数据 |

## 本地开发

```bash
pnpm install
pnpm dev        # http://localhost:4321
```

其他命令：

```bash
pnpm sync       # 只重新抓取 GitHub 数据
pnpm build      # 抓取数据 + 构建到 dist/
pnpm preview    # 预览构建产物
pnpm check      # 类型检查
```

## 写一篇新文章

在 `src/content/posts/` 下新建 `.md` 文件，文件名即 URL：

```markdown
---
title: 文章标题
description: 一段用于 SEO 和列表页的摘要。
pubDate: 2026-08-21
category: tech          # tech | life
tags: ['Slurm', 'HPC']
featured: false         # 首页头条（更大的标题与摘要）
draft: false            # true 时只在本地可见，不会发布
excerpt: 列表页显示的一行提要，省略则回退到 description
---

正文从这里开始。
```

字段定义在 `src/content.config.ts`，写错会在构建时报错而不是静默失败。

发布流程：提交并推送到 `main`，GitHub Actions 会自动构建部署。

```bash
git add . && git commit -m "post: 文章标题" && git push
```

## GitHub 数据同步

`scripts/fetch-github.mjs` 在每次构建前运行，把账号数据落盘到 `src/data/github.json` 和 `public/avatar.png`：

- 头像、简介、粉丝数、仓库总数、star 总数
- 贡献热力图（过去一年）
- 置顶仓库列表（按 star 与最近推送排序）

语言列表是手动维护的，改 `src/consts.ts` 里的 `LANGUAGES` 即可，不走 GitHub 统计。

脚本只读取公开数据。

数据来源分两档：

| 情况 | 贡献日历 |
| --- | --- |
| 有 `GITHUB_TOKEN` | GitHub GraphQL（官方数据） |
| 匿名（本地开发） | 公开第三方 API |

抓取失败时会沿用上一次的 `github.json`，不会让构建挂掉。

CI 里用的是 Actions 内置的 `secrets.GITHUB_TOKEN`，不需要你手动配任何凭据。

想在本地用官方贡献日历，用环境变量临时传入，别写进文件：

```bash
GITHUB_TOKEN=github_pat_xxx pnpm sync
```

> 凭据只会发往 `api.github.com`。第三方贡献 API 和头像 CDN 的请求不带 `Authorization`——见 `headersFor()`。

### 让热力图包含私有贡献（不需要 token）

GitHub 个人设置里有个开关：Settings → Profile → **Include private contributions on my profile**。打开后贡献日历的**数字**会算上私有仓库，但不会暴露仓库名，连匿名 API 都能读到。不需要任何 token。

## 部署地址与子路径

仓库名为 `0xKaeruIO.github.io`，属于 GitHub 用户页，站点直接落在根路径 `https://0xkaeruio.github.io/`。

`astro.config.mjs` 里的 `site` 和 `base` 由环境变量控制，CI 中自动从 GitHub Pages 的配置推导，所以换部署方式不用改代码：

| 场景 | 需要做的事 |
| --- | --- |
| 当前（用户页，根路径） | 无 |
| 绑定自定义域名 | 在 `public/` 下放一个 `CNAME` 文件，内容为域名 |
| 改成项目页（仓库换名） | 本地开发用 `BASE=/<仓库名> pnpm dev`；CI 会自动适配 |

改仓库名后记得同步更新 `src/consts.ts` 里的 `repo`，它决定文章底部「在 GitHub 上编辑」的链接。

## 目录结构

```
src/
├── components/          # Header、文章卡片、热力图、语言图表、仓库网格…
├── content/posts/       # 文章（Markdown）
├── data/github.json     # 构建时生成，不用手改
├── layouts/             # BaseLayout（站点框架）、PostLayout（文章页）
├── pages/               # 路由：首页、归档、标签、关于、RSS、404
├── styles/global.css    # 设计 token 与全局样式
├── utils/               # 文章查询、日期格式化、GitHub 数据类型
└── consts.ts            # 站点标题、导航、作者等配置
```

改站点标题、导航项、每页文章数：编辑 `src/consts.ts`。
改配色、字号、圆角：编辑 `src/styles/global.css` 顶部的 `:root`。
