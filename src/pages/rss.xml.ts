import rss from '@astrojs/rss';
import type { APIRoute } from 'astro';
import { SITE } from '@/consts';
import { getPublishedPosts } from '@/utils/posts';
import { withBase } from '@/utils/url';

export const GET: APIRoute = async (context) => {
  const posts = await getPublishedPosts();

  return rss({
    title: SITE.title,
    description: SITE.description,
    // rss() 不会自动带上 base，站点部署在子路径时必须手动拼进去
    site: new URL(import.meta.env.BASE_URL, context.site!).href,
    trailingSlash: false,
    items: posts.map((post) => ({
      title: post.data.title,
      description: post.data.description,
      pubDate: post.data.pubDate,
      categories: post.data.tags,
      link: withBase(`/posts/${post.id}`),
    })),
    customData: `<language>zh-cn</language>`,
  });
};
