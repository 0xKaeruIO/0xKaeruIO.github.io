const BASE = import.meta.env.BASE_URL;

/** 拼接站点 base 前缀，让站点在「项目页 / 用户页 / 自定义域名」下都能正确出链。 */
export function withBase(path: string): string {
  if (/^(https?:)?\/\//.test(path) || path.startsWith('#') || path.startsWith('mailto:')) {
    return path;
  }
  const base = BASE.endsWith('/') ? BASE.slice(0, -1) : BASE;
  const rest = path.startsWith('/') ? path : `/${path}`;
  return `${base}${rest}` || '/';
}

/** 判断导航项是否命中当前路径（用于高亮当前栏目）。 */
export function isActivePath(current: string, target: string): boolean {
  const strip = (p: string) => {
    const base = BASE.endsWith('/') ? BASE.slice(0, -1) : BASE;
    const withoutBase = p.startsWith(base) ? p.slice(base.length) : p;
    const trimmed = withoutBase.replace(/\/+$/, '');
    return trimmed === '' ? '/' : trimmed;
  };
  const now = strip(current);
  const to = strip(target);
  if (to === '/') return now === '/';
  return now === to || now.startsWith(`${to}/`);
}
