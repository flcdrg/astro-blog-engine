import type { CollectionEntry } from "astro:content";
import { DateTime } from "luxon";

type BlogPost = CollectionEntry<"blog">;

const now = DateTime.now();

export function isCurrentPost(post: BlogPost): boolean {
  return import.meta.env.DEV || DateTime.fromISO(post.data.date) <= now;
}

export function getCurrentPosts(posts: BlogPost[]): BlogPost[] {
  return posts.filter(isCurrentPost);
}

export function getPostDateMillis(post: BlogPost): number {
  return DateTime.fromISO(post.data.date).toMillis();
}

export function sortPostsByDate(
  posts: BlogPost[],
  direction: "ascending" | "descending" = "ascending",
): BlogPost[] {
  const directionMultiplier = direction === "ascending" ? 1 : -1;

  return [...posts].sort(
    (a, b) =>
      directionMultiplier * (getPostDateMillis(a) - getPostDateMillis(b)),
  );
}

export function getUniqueTags(posts: BlogPost[]): string[] {
  return [...new Set(posts.flatMap((post) => post.data.tags))];
}

export function groupPostsByTag(
  posts: BlogPost[],
): Map<string, BlogPost[]> {
  const postsByTag = new Map<string, BlogPost[]>();

  for (const post of posts) {
    for (const tag of new Set(post.data.tags)) {
      const taggedPosts = postsByTag.get(tag);
      if (taggedPosts) {
        taggedPosts.push(post);
      } else {
        postsByTag.set(tag, [post]);
      }
    }
  }

  return postsByTag;
}
