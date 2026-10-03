import { describe, expect, it } from "vitest";

import {
  countWords,
  indexWordThreshold,
  isBelowIndexWordThreshold,
  isPostFrom2025Onwards,
  isPostNoindex,
} from "./indexing";

describe("countWords", () => {
  it("counts trimmed, whitespace-separated words", () => {
    expect(countWords("  one   two\nthree  ")).toBe(3);
  });

  it("returns zero for empty or missing content", () => {
    expect(countWords("")).toBe(0);
    expect(countWords(undefined)).toBe(0);
  });
});

describe("isBelowIndexWordThreshold", () => {
  it("uses a strict threshold boundary", () => {
    expect(isBelowIndexWordThreshold(indexWordThreshold - 1)).toBe(true);
    expect(isBelowIndexWordThreshold(indexWordThreshold)).toBe(false);
    expect(isBelowIndexWordThreshold(undefined)).toBe(false);
  });
});

describe("isPostFrom2025Onwards", () => {
  it("includes posts from 2025 and later", () => {
    expect(isPostFrom2025Onwards("2025-01-01")).toBe(true);
    expect(isPostFrom2025Onwards("2026-10-03T09:00:00+00:00")).toBe(true);
  });

  it("excludes earlier and invalid dates", () => {
    expect(isPostFrom2025Onwards("2024-12-31")).toBe(false);
    expect(isPostFrom2025Onwards("not-a-date")).toBe(false);
    expect(isPostFrom2025Onwards("")).toBe(false);
  });
});

describe("isPostNoindex", () => {
  it("noindexes short posts published before 2025", () => {
    expect(isPostNoindex({ date: "2024-12-31" }, 99)).toBe(true);
  });

  it("keeps posts indexable at the word boundary or from 2025 onwards", () => {
    expect(isPostNoindex({ date: "2024-12-31" }, 100)).toBe(false);
    expect(isPostNoindex({ date: "2025-01-01" }, 99)).toBe(false);
  });

  it("honours an explicit index override", () => {
    expect(isPostNoindex({ date: "2024-12-31", index: true }, 1)).toBe(false);
  });
});
