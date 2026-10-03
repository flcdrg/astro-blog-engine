import type { CollectionEntry } from "astro:content";
import { describe, expect, it, vi } from "vitest";

import { buildFeedEntry, getFeedUpdatedDate } from "./feed";

vi.mock("./resolveFeedImageSrc", () => ({
  resolveFeedImageSrc: vi.fn(async (src: string) =>
    src.startsWith("../../assets/")
      ? "https://example.com/_astro/image.png"
      : undefined,
  ),
}));

type BlogPost = CollectionEntry<"blog">;

function post(
  id: string,
  date: string,
  options: { modified_time?: string; body?: string } = {},
): BlogPost {
  return {
    id,
    body: options.body,
    data: {
      date,
      modified_time: options.modified_time,
      title: `Title for ${id}`,
      description: "A post description",
      tags: ["astro", "blog"],
    },
  } as BlogPost;
}

describe("feed helpers", () => {
  it("builds a sanitised Atom entry and resolves image URLs", async () => {
    const entry = await buildFeedEntry(
      post("2026/01/example", "2026-01-01T00:00:00+00:00", {
        modified_time: "2026-02-01T00:00:00+00:00",
        body: "![Example](../../assets/example.png)\n\n<script>alert('unsafe')</script>",
      }),
      new URL("https://example.com/"),
    );

    expect(entry).toMatchObject({
      id: "https://example.com/2026/01/example",
      updated: "2026-02-01T00:00:00+00:00",
      published: "2026-01-01T00:00:00+00:00",
      title: "Title for 2026/01/example",
      summary: { type: "html", value: "A post description" },
      category: [{ term: "astro" }, { term: "blog" }],
      link: [
        {
          rel: "alternate",
          href: "https://example.com/2026/01/example",
          type: "text/html",
        },
      ],
    });
    expect(entry.content).toMatchObject({
      type: "html",
      value: expect.stringContaining(
        '<img src="https://example.com/_astro/image.png" alt="Example" />',
      ),
    });
    expect(entry.content).not.toMatchObject({
      value: expect.stringContaining("<script>"),
    });
  });

  it("uses the newest modified or published date for the feed update time", () => {
    const posts = [
      post("older", "2026-01-01T00:00:00+00:00"),
      post("newer", "2026-02-01T00:00:00+00:00", {
        modified_time: "2026-03-01T00:00:00+00:00",
      }),
      post("published-later", "2026-04-01T00:00:00+00:00", {
        modified_time: "2026-02-15T00:00:00+00:00",
      }),
    ];

    expect(getFeedUpdatedDate(posts)).toBe("2026-04-01T00:00:00.000Z");
    expect(getFeedUpdatedDate([])).toBe("1970-01-01T00:00:00.000Z");
  });
});
