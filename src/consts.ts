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

/**
 * 首页 / 关于页滚动展示的语言。改这里就会出现在页面上，不走 GitHub 统计。
 * snippet 是该语言的 Hello World，用来填满胶囊。
 */
export const LANGUAGES = [
  { name: 'Python', snippet: 'print("Hello, World!")' },
  { name: '蔚蓝', snippet: '攀登本身,就是意义' },
  { name: 'Go', snippet: 'fmt.Println("Hello, World!")' },
  { name: '岩田聪', snippet: '电子游戏只需要做一件事: 有趣' },
  { name: 'Rust', snippet: 'println!("Hello, World!");' },
  { name: '爱梅特赛尔克', snippet: '生命的意义，不在于终点，而在于旅途本身。' },
  { name: 'Bash', snippet: 'echo "Hello, World!"' },
  { name: '晓美焰', snippet: '只要有你在，这个世界就还有意义。' },
  { name: 'JavaScript', snippet: 'console.log("Hello, World!");' },
  { name: '特图', snippet: '这个世界就是一场无聊的游戏——规则不明，目标未定，七十亿玩家肆意妄为' },
  { name: '宫本茂', snippet: '好的游戏设计，是教会玩家如何思考，而不是告诉他们答案。' },
] as const;
