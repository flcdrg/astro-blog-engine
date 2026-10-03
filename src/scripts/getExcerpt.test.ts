import { describe, expect, it } from "vitest";

import getExcerpt from "./getExcerpt";

describe("getExcerpt", () => {
  it("extracts paragraph text and strips nested markup", () => {
    expect(getExcerpt("<p>Hello <strong>world</strong>.</p>", 100)).toBe(
      "Hello world.",
    );
  });

  it("joins complete paragraphs until adding the next would exceed the limit", () => {
    expect(getExcerpt("<p>First</p><p>Second</p><p>Third</p>", 12)).toBe(
      "First Second …",
    );
  });

  it("adds an ellipsis when the result is within ten per cent of the limit", () => {
    expect(getExcerpt("<p>1234567890</p>", 10)).toBe("1234567890 …");
  });

  it("does not add an ellipsis to a result below the cutoff", () => {
    expect(getExcerpt("<p>12345678</p>", 10)).toBe("12345678");
  });

  it("returns an empty excerpt when there are no paragraph elements", () => {
    expect(getExcerpt("<div>not a paragraph</div>", 100)).toBe("");
  });
});
