import { describe, expect, it } from "vitest";
import { parseHistoryIds } from "../src/lib/history-drag";

describe("history drag payload", () => {
  it("keeps unique ids and ignores anything else", () => {
    expect(parseHistoryIds('["gen-1"," gen-2 ","gen-1",""]')).toEqual(["gen-1", "gen-2"]);
    expect(parseHistoryIds("[1, null]")).toEqual([]);
    expect(parseHistoryIds("not-json")).toEqual([]);
    expect(parseHistoryIds('{"id":"gen-1"}')).toEqual([]);
  });
});
