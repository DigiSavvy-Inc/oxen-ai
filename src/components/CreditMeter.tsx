import { OXEN_BILLING_URL, type CreditBalance } from "../lib/api";

export function CreditMeter({ credits }: { credits: CreditBalance | null }) {
  const href = credits?.billingUrl || OXEN_BILLING_URL;
  const label =
    credits?.remaining != null
      ? `${credits.currency === "USD" ? "$" : ""}${credits.remaining.toFixed(2)}`
      : "Buy Credits";

  return (
    <a
      className="credit-meter"
      href={href}
      target="_blank"
      rel="noreferrer"
      aria-label="Buy Credits"
    >
      {label}
    </a>
  );
}
