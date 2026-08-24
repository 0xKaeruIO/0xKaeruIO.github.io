import type { APIRoute } from 'astro';
import { getSearchIndex } from '@/utils/posts';

export const GET: APIRoute = async () => {
  const items = await getSearchIndex();
  return new Response(JSON.stringify(items), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
};
