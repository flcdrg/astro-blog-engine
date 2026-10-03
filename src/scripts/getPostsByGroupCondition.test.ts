import type { CollectionEntry } from "astro:content";
import { describe, expect, it } from "vitest";

import getPostsByGroupCondition from "./getPostsByGroupCondition";

type Post = CollectionEntry<"blog">;

function post(id: string): Post {
  return { id } as Post;
}

describe("getPostsByGroupCondition", () => {
  it("groups posts while preserving their order within each group", () => {
    const first = post("2025/01/first");
    const second = post("2026/01/second");
    const third = post("2025/02/third");

    const groups = getPostsByGroupCondition(
      [first, second, third],
      (entry) => entry.id.slice(0, 4),
    );

    expect(groups).toEqual({
      "2025": [first, third],
      "2026": [second],
    });
  });

  it("returns an empty object for no posts", () => {
    expect(getPostsByGroupCondition([], () => "unused")).toEqual({});
  });

  it("supports symbol group keys", () => {
    const key = Symbol("group");
    const item = post("2025/01/post");

    expect(getPostsByGroupCondition([item], () => key)[key]).toEqual([item]);
  });

  it("passes the post index to the grouping callback", () => {
    const items = [post("one"), post("two")];

    expect(
      getPostsByGroupCondition(items, (_entry, index) => index ?? -1),
    ).toEqual({ "0": [items[0]], "1": [items[1]] });
  });
});
