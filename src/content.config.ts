import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'zod';

const posts = defineCollection({
  loader: glob({
    base: './src/content/posts',
    pattern: ['**/*.{md,mdx}', '!images/**'],
  }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    category: z.enum(['tech', 'life']).default('tech'),
    tags: z.array(z.string()).default([]),
    /** 置顶到首页 */
    featured: z.boolean().default(false),
    /** 草稿不会出现在生产构建里 */
    draft: z.boolean().default(false),
    /** 列表页的一行提要，缺省时回退到 description */
    excerpt: z.string().optional(),
  }),
});

export const collections = { posts };
