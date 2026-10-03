import type { CollectionEntry } from "astro:content";
import { describe, expect, it } from "vitest";

import {
  getCurrentPosts,
  getPostDateMillis,
  getUniqueTags,
  groupPostsByTag,
  sortPostsByDate,
} from "./posts";

type Post = CollectionEntry<"blog">;

function post(id: string, date: string, tags: string[] = []): Post {
  return { id, data: { date, tags } } as Post;
}

describe("post helpers", () => {
  it("sorts by date with Luxon and leaves the input unchanged", () => {
    const older = post("older", "2025-01-01T00:00:00+00:00");
    const newer = post("newer", "2025-01-01T02:00:00+02:00");
    const newest = post("newest", "2025-01-02T00:00:00+00:00");
    const posts = [newest, newer, older];

    expect(sortPostsByDate(posts).map(({ id }) => id)).toEqual([
      "newer",
      "older",
      "newest",
    ]);
    expect(sortPostsByDate(posts, "descending").map(({ id }) => id)).toEqual([
      "newest",
      "newer",
      "older",
    ]);
    expect(posts).toEqual([newest, newer, older]);
    expect(getPostDateMillis(older)).toBe(getPostDateMillis(newer));
  });

  it("returns the current posts in development", () => {
    const postA = post("published", "2025-01-01T00:00:00+00:00");
    const postB = post("future", "2999-01-01T00:00:00+00:00");

    expect(getCurrentPosts([postA, postB])).toEqual([postA, postB]);
  });

  it("collects unique tags in first-seen order", () => {
    const posts = [
      post("first", "2025-01-01T00:00:00+00:00", ["astro", "astro", "blog"]),
      post("second", "2025-01-02T00:00:00+00:00", ["blog", "typescript"]),
    ];

    expect(getUniqueTags(posts)).toEqual(["astro", "blog", "typescript"]);
  });

  it("groups posts by tag without duplicating a post for repeated tags", () => {
    const first = post("first", "2025-01-01T00:00:00+00:00", ["astro", "astro"]);
    const second = post("second", "2025-01-02T00:00:00+00:00", ["astro", "blog"]);

    expect([...groupPostsByTag([first, second])]).toEqual([
      ["astro", [first, second]],
      ["blog", [second]],
    ]);
  });
});
