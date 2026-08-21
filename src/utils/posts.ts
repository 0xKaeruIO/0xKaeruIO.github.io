import { getCollection, type CollectionEntry } from 'astro:content';

export type Post = CollectionEntry<'posts'>;

/** 已发布的文章，按时间倒序。草稿只在开发环境可见。 */
export async function getPublishedPosts(): Promise<Post[]> {
  const posts = await getCollection('posts', ({ data }) =>
    import.meta.env.PROD ? data.draft !== true : true,
  );
  return posts.sort((a, b) => b.data.pubDate.getTime() - a.data.pubDate.getTime());
}

export async function getPostsByCategory(category: 'tech' | 'life'): Promise<Post[]> {
  const posts = await getPublishedPosts();
  return posts.filter((p) => p.data.category === category);
}

export interface TagCount {
  tag: string;
  count: number;
}

/** 全部标签，按使用次数降序、同频次按字母序。 */
export async function getAllTags(): Promise<TagCount[]> {
  const posts = await getPublishedPosts();
  const counter = new Map<string, number>();
  for (const post of posts) {
    for (const tag of post.data.tags) {
      counter.set(tag, (counter.get(tag) ?? 0) + 1);
    }
  }
  return [...counter.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'zh-CN'));
}

/** 按发布顺序取上一篇/下一篇，用于文章底部导航。 */
export function getAdjacent(posts: Post[], id: string) {
  const i = posts.findIndex((p) => p.id === id);
  return {
    newer: i > 0 ? posts[i - 1] : undefined,
    older: i >= 0 && i < posts.length - 1 ? posts[i + 1] : undefined,
  };
}

/** 同标签优先、同分类兜底的相关文章推荐。 */
export function getRelated(posts: Post[], current: Post, limit = 3): Post[] {
  const tags = new Set(current.data.tags);
  return posts
    .filter((p) => p.id !== current.id)
    .map((p) => {
      const shared = p.data.tags.filter((t) => tags.has(t)).length;
      const sameCategory = p.data.category === current.data.category ? 0.5 : 0;
      return { post: p, score: shared + sameCategory };
    })
    .filter((x) => x.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.post.data.pubDate.getTime() - a.post.data.pubDate.getTime(),
    )
    .slice(0, limit)
    .map((x) => x.post);
}
