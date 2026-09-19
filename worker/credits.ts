export const OXEN_BILLING_URL = "https://www.oxen.ai/digisavvy/settings/billing";

const OXEN_HUB = "https://hub.oxen.ai";

const SKIP_KEYS = new Set([
  "credits_used",
  "creditsUsed",
  "used",
  "spent",
  "total_cost",
  "totalCost",
  "cost",
]);

const REMAINING_KEYS = [
  "remaining",
  "remaining_credits",
  "remainingCredits",
  "credits_remaining",
  "creditsRemaining",
  "credit_balance",
  "creditBalance",
  "available_credits",
  "availableCredits",
  "prepaid_credits",
  "prepaidCredits",
  "current_balance",
  "currentBalance",
  "available_balance",
  "availableBalance",
  "amount_remaining",
  "amountRemaining",
  "balance",
  "credits",
] as const;

const CENTS_KEYS = [
  "remaining_cents",
  "remainingCents",
  "credit_cents",
  "creditCents",
  "balance_cents",
  "balanceCents",
  "credits_cents",
  "creditsCents",
] as const;

const WRAPPER_KEYS = [
  "data",
  "user",
  "account",
  "billing",
  "wallet",
  "organization",
  "org",
  "namespace",
  "subscription",
] as const;

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

export function parseCreditsRemaining(data: unknown, depth = 0): number | null {
  if (data == null || depth > 5) return null;
  if (typeof data !== "object") return asFiniteNumber(data);
  if (Array.isArray(data)) {
    for (const item of data) {
      const found = parseCreditsRemaining(item, depth + 1);
      if (found != null) return found;
    }
    return null;
  }

  const record = data as Record<string, unknown>;
  for (const key of CENTS_KEYS) {
    if (!(key in record)) continue;
    const cents = asFiniteNumber(record[key]);
    if (cents != null) return cents / 100;
  }
  for (const key of REMAINING_KEYS) {
    if (!(key in record) || SKIP_KEYS.has(key)) continue;
    const value = record[key];
    const direct = asFiniteNumber(value);
    if (direct != null) return direct;
    const nested = parseCreditsRemaining(value, depth + 1);
    if (nested != null) return nested;
  }
  for (const key of WRAPPER_KEYS) {
    if (!(key in record)) continue;
    const nested = parseCreditsRemaining(record[key], depth + 1);
    if (nested != null) return nested;
  }
  return null;
}

export async function fetchOxenCredits(apiKey: string): Promise<number | null> {
  try {
    const res = await fetch(`${OXEN_HUB}/api/users/me`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
    });
    if (!res.ok) return null;
    return parseCreditsRemaining(await res.json());
  } catch {
    return null;
  }
}

export type CreditBalance = {
  remaining: number | null;
  currency: "USD";
  billingUrl: string;
};

export function creditBalanceResponse(remaining: number | null): CreditBalance {
  return {
    remaining,
    currency: "USD",
    billingUrl: OXEN_BILLING_URL,
  };
}
