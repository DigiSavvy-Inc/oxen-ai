import { afterEach, describe, expect, it } from "vitest";
import {
  OXEN_BILLING_URL,
  creditBalanceResponse,
  fetchOxenCredits,
  parseCreditsRemaining,
} from "../worker/credits";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("parseCreditsRemaining", () => {
  it("reads remaining, balance, and nested credits", () => {
    expect(parseCreditsRemaining({ remaining: 12.5 })).toBe(12.5);
    expect(parseCreditsRemaining({ balance: "8" })).toBe(8);
    expect(parseCreditsRemaining({ data: { credits: { remaining: 3 } } })).toBe(3);
    expect(parseCreditsRemaining({ user: { credit_balance: 0 } })).toBe(0);
    expect(parseCreditsRemaining({ available_credits: "19.5" })).toBe(19.5);
    expect(parseCreditsRemaining({ remaining_cents: 1250 })).toBe(12.5);
  });

  it("returns null when no credit field is present", () => {
    expect(parseCreditsRemaining({ user: { username: "ME" } })).toBeNull();
    expect(parseCreditsRemaining(null)).toBeNull();
  });
});

describe("fetchOxenCredits", () => {
  it("uses the first candidate that returns a parseable remaining balance", async () => {
    const seen: string[] = [];
    globalThis.fetch = async (input) => {
      const url = String(input);
      seen.push(url);
      if (url.endsWith("/api/account")) {
        return new Response(JSON.stringify({ remaining: 42.1 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("Not Found", { status: 404 });
    };

    await expect(fetchOxenCredits("test-key")).resolves.toBe(42.1);
    expect(seen).toContain("https://hub.oxen.ai/api/account");
  });

  it("returns null when no candidate exposes a balance", async () => {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ user: { username: "ME" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    await expect(fetchOxenCredits("test-key")).resolves.toBeNull();
  });
});

describe("creditBalanceResponse", () => {
  it("always includes the Oxen billing URL", () => {
    expect(creditBalanceResponse(null)).toEqual({
      remaining: null,
      currency: "USD",
      billingUrl: OXEN_BILLING_URL,
    });
    expect(OXEN_BILLING_URL).toBe("https://www.oxen.ai/digisavvy/settings/billing");
  });
});
