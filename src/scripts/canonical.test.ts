import { describe, expect, it } from "vitest";

import { getCanonicalUrl } from "./canonical";

describe("getCanonicalUrl", () => {
  it("removes a terminal .html extension", () => {
    expect(
      getCanonicalUrl(
        new URL("https://example.com/2025/01/post.html"),
        new URL("https://example.com"),
      ),
    ).toEqual(new URL("https://example.com/2025/01/post"));
  });

  it("maps /index and /index.html to the site root", () => {
    const site = new URL("https://example.com");

    expect(getCanonicalUrl(new URL("https://example.com/index"), site)).toEqual(
      new URL("https://example.com/"),
    );
    expect(
      getCanonicalUrl(new URL("https://example.com/index.html"), site),
    ).toEqual(new URL("https://example.com/"));
  });

  it("preserves .html when it is not a terminal extension", () => {
    expect(
      getCanonicalUrl(
        new URL("https://example.com/archive.html/page"),
        new URL("https://example.com"),
      ),
    ).toEqual(new URL("https://example.com/archive.html/page"));
  });

  it("uses the current URL as the base when the site is not configured", () => {
    expect(
      getCanonicalUrl(new URL("https://preview.example.com/post.html"), undefined),
    ).toEqual(new URL("https://preview.example.com/post"));
  });
});
