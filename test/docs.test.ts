import { describe, expect, it } from "vitest";
import { DOC_ARTICLES, filterDocs } from "../src/lib/docs";

describe("filterDocs", () => {
  it("returns every article when the query and category are open", () => {
    expect(filterDocs(DOC_ARTICLES, "", "All")).toHaveLength(DOC_ARTICLES.length);
  });

  it("filters by category", () => {
    const shortcuts = filterDocs(DOC_ARTICLES, "", "Shortcuts");
    expect(shortcuts.map((article) => article.id)).toEqual(["shortcuts"]);
  });

  it("describes collections under Saved prompts and galleries, and ⌘⇧G under shortcuts", () => {
    const text = (id: string) =>
      DOC_ARTICLES.find((article) => article.id === id)!
        .blocks.map((block) => (block.type === "p" ? block.text : block.items.join("\n")))
        .join("\n");
    const galleries = DOC_ARTICLES.find((article) => article.title === "Saved prompts and galleries")!;
    const body = text(galleries.id);
    for (const phrase of ["A collection", "Move to collection", "All assets", "Set as cover", "Reset cover", "Ungrouped"]) {
      expect(body).toContain(phrase);
    }
    // Deleting a collection must never read as deleting the work inside it.
    expect(body).toContain("Deleting a collection keeps its galleries and files.");
    expect(text("shortcuts")).toMatch(/⌘⇧G[^\n]*Galleries screen with its collections/);
    expect(filterDocs(DOC_ARTICLES, "collection", "All").map((article) => article.id)).toEqual(
      expect.arrayContaining([galleries.id, "shortcuts"]),
    );
  });

  it("searches across title and body, and keeps the category filter", () => {
    expect(filterDocs(DOC_ARTICLES, "480p render", "All").map((article) => article.id)).toEqual([
      "draft",
    ]);
    expect(filterDocs(DOC_ARTICLES, "draft", "Library")).toEqual([]);
    expect(filterDocs(DOC_ARTICLES, "oxen key", "Setup").map((article) => article.id)).toEqual([
      "sign-in",
      "oxen-key",
    ]);
  });
});
