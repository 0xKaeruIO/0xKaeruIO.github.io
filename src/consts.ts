export const SITE = {
  title: 'ricedev',
  tagline: 'if Code() && Game() { Happy() }',
  description:
    '记录高性能计算、Slurm 调度、系统工程的技术笔记，以及一些日常生活的碎片。',
  author: 'ricedev',
  githubUser: '0xKaeruIO',
  /** 本站源码所在仓库，用于生成文章的「在 GitHub 上编辑」链接 */
  repo: '0xKaeruIO.github.io',
  lang: 'zh-CN',
  locale: 'zh_CN',
} as const;

export const NAV_LINKS = [
  { href: '/', label: '首页', en: 'Home' },
  { href: '/posts', label: '文章', en: 'Writing' },
  { href: '/life', label: '生活', en: 'Life' },
  { href: '/tags', label: '标签', en: 'Tags' },
  { href: '/about', label: '关于', en: 'About' },
] as const;

export const CATEGORY_LABELS: Record<string, string> = {
  tech: '技术',
  life: '生活',
};
