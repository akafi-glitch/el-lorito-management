import { formatCents } from "@/features/menu/money";

import { formatRate, type Totals } from "../tax";

/** Food and liquor subtotals, each tax with its rate, and the total, as on the printed ticket. */
export function TotalsBlock({ totals, large = true }: { totals: Totals; large?: boolean }) {
  const rows: [string, number][] = [
    ["Food subtotal", totals.foodSubtotalCents],
    ["Liquor subtotal", totals.liquorSubtotalCents],
    [`Food tax (${formatRate(totals.rates.food)})`, totals.foodTaxCents],
    [`Liquor tax (${formatRate(totals.rates.liquor)})`, totals.liquorTaxCents],
  ];
  return (
    <dl className="flex flex-col gap-1" aria-label="Totals">
      {rows.map(([label, cents]) => (
        <div key={label} className="flex justify-between gap-3 text-sm text-ink">
          <dt>{label}</dt>
          <dd className="tabular-nums">{formatCents(cents)}</dd>
        </div>
      ))}
      <div className="mt-1 flex items-baseline justify-between gap-3 border-t-2 border-ink/20 pt-2">
        <dt className="text-base font-bold text-ink">Total</dt>
        <dd className={`font-bold tabular-nums text-ink ${large ? "text-2xl" : "text-lg"}`} data-testid="ticket-total">
          {formatCents(totals.totalCents)}
        </dd>
      </div>
    </dl>
  );
}
