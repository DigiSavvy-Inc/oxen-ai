import { describe, expect, it } from "vitest";
import { libraryCountSql, libraryListSql, parseLibraryPage } from "../worker/library-page";

describe("parseLibraryPage", () => {
  it("defaults to 24 history groups on page 1", () => {
    expect(parseLibraryPage(undefined, undefined, undefined)).toEqual({
      page: 1,
      pageSize: 24,
      tag: "",
    });
  });

  it("rejects page sizes outside the allowed steps", () => {
    expect(parseLibraryPage("2", "100", "#Campaign")).toEqual({
      page: 2,
      pageSize: 24,
      tag: "Campaign",
    });
    expect(parseLibraryPage("0", "48", "  logo ")).toEqual({
      page: 1,
      pageSize: 48,
      tag: "logo",
    });
  });
});

describe("library page sql", () => {
  it("pages by history group and offsets from the requested page", () => {
    const query = parseLibraryPage("3", "12", "");
    const list = libraryListSql("user-1", query);
    expect(list.sql).toContain("LIMIT ?");
    expect(list.sql).toContain("OFFSET ?");
    expect(list.sql).not.toContain("LIMIT 100");
    expect(list.binds).toEqual(["user-1", "", "user-1", "%%", 12, 24, "user-1"]);
    const count = libraryCountSql("user-1", query);
    expect(count.sql).toContain("COUNT(*)");
    expect(count.binds).toEqual(["user-1", "", "user-1", "%%"]);
    const scoped = libraryListSql("user-1", query, "profile-1");
    expect(scoped.sql).toContain("profile_id = ?");
    expect(scoped.binds).toEqual(["user-1", "profile-1", "", "user-1", "%%", 12, 24, "user-1", "profile-1"]);
    expect(libraryListSql("user-1", query).sql).not.toContain("profile_id");
  });
});
