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
