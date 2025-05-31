import { glob } from "astro/loaders";
import { defineCollection, getCollection, reference, z } from "astro:content";
import { DateTime } from "luxon";
import onlyCurrent from "./scripts/filters";

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
      description: z.string().optional(),
    }),
});

const tags = defineCollection({
  type: "content_layer",
  loader: async () => {
    const allPosts: Array<{ data: { tags: string[] }; id: string }> = (await getCollection("blog")).filter(onlyCurrent);

    // Collate all tags from all posts and count posts per tag
    const tagCounts = allPosts
      .flatMap((post: any) => post.data.tags)
      .reduce((acc: Record<string, number>, tag: string) => {
        acc[tag] = (acc[tag] || 0) + 1;
        return acc;
      }, {});

    const list = Object.entries(tagCounts).sort(([tagA], [tagB]) =>
      tagA.localeCompare(tagB)
    );

    // dictionary of tags and their posts
    const tagPosts: Record<string, Array<string>> = {};
    allPosts.forEach((post) => {
      post.data.tags.forEach((tag) => {
        if (!tagPosts[tag]) {
          tagPosts[tag] = [];
        }
        tagPosts[tag].push(post.id);
      });
    });

    return list.map(([tag, count]) => ({
      id: tag,
      count,
      posts: (tagPosts[tag] ?? []).map((postId) => postId),
    }));
  },
  schema: z.object({
    id: z.string(),
    count: z.number(),
    posts: z.array(reference("blog")),
  }),
});

export const collections = { blog, tags };
