import { deriveTitle, FALLBACK_TITLE, MAX_TITLE_LENGTH } from "./titles";

describe("deriveTitle", () => {
  it("uses the first non-empty line", () => {
    expect(deriveTitle("\n\n  How do I sort a Vec in Rust?\nmore text")).toBe("How do I sort a Vec in Rust?");
  });

  it("strips markdown noise", () => {
    expect(deriveTitle("## **Explain** `async` code")).toBe("Explain async code");
    expect(deriveTitle("- bullet point idea")).toBe("bullet point idea");
  });

  it("skips code fences", () => {
    expect(deriveTitle("```ts\nconst x = 1;\n```")).toBe("const x = 1;");
  });

  it("truncates long text on a word boundary with an ellipsis", () => {
    const title = deriveTitle("word ".repeat(40));
    expect(title.length).toBeLessThanOrEqual(MAX_TITLE_LENGTH + 1);
    expect(title.endsWith("…")).toBe(true);
    expect(title).not.toMatch(/\s…$/);
  });

  it("falls back when there is no usable text", () => {
    expect(deriveTitle("   \n ")).toBe(FALLBACK_TITLE);
    expect(deriveTitle("```")).toBe(FALLBACK_TITLE);
  });
});
