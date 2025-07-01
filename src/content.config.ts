import { glob } from "astro/loaders";
import { defineCollection, z } from "astro:content";
import { DateTime } from "luxon";

const blog = defineCollection({
  type: "content_layer",
  loader: glob({ 
    pattern: "**/*.{md,mdx}", 
    base: "./src/posts",
    generateId: ({ entry, data }) => {
      const date = DateTime.fromISO(data.date as string, { setZone: true });

      const id = entry.substring(16);
      const slug = `${date.toFormat("yyyy")}/${date.toFormat("MM")}/${id}`;

      return slug.replace(/\.mdx?$/, '');
    },
  }),
  schema: ({ image }) =>
    z.object({
      date: z.string().datetime({ offset: true }),
      title: z.string(),
      draft: z.boolean().optional().default(false),
      tags: z.array(z.string()).default(["others"]),
      image: image().optional(),
      imageAlt: z.string().optional(),
      description: z.string().trim().optional(),
    }),
});

export const collections = { blog };
