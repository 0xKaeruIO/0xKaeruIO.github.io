// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// 部署地址由环境变量控制，CI 里会从 GitHub Pages 的配置自动推导。
// - 用户页(默认)：https://0xkaeruio.github.io/
// - 自定义域名：设置 SITE=https://your.domain
// - 若改回项目页仓库：设置 BASE=/<仓库名>
const SITE = process.env.SITE ?? 'https://0xkaeruio.github.io';
const BASE = process.env.BASE ?? '/';

export default defineConfig({
  site: SITE,
  base: BASE,
  trailingSlash: 'ignore',
  integrations: [sitemap()],
  markdown: {
    shikiConfig: {
      themes: { light: 'github-light', dark: 'night-owl' },
      wrap: false,
    },
  },
  build: {
    inlineStylesheets: 'auto',
  },
});
