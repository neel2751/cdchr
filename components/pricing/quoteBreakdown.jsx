import { formatMoney } from "@/lib/money";

/**
 * A quote from lib/pricing.js quote(), as a table a person can read out to a
 * customer: each company's lines, then discounts, VAT and the total for the
 * billing period. Renders nothing for an empty quote.
 */
export default function QuoteBreakdown({ result }) {
  if (!result || !result.companies?.some((c) => c.lines.length)) {
    return (
      <p className="text-sm text-muted-foreground">
        Choose a package to see the price.
      </p>
    );
  }
  const money = (p) => formatMoney(p, result.currency);
  const yearly = result.cycle === "yearly";
  const many = result.companies.length > 1;

  return (
    <div className="space-y-3 text-sm">
      {result.companies.map((c, i) => (
        <div key={i} className="space-y-1">
          {many && (
            <p className="font-medium">
              {c.label}
              {c.planName ? ` · ${c.planName}` : ""}
            </p>
          )}
          <table className="w-full">
            <tbody>
              {c.lines.map((l) => (
                <tr key={l.key} className="align-top">
                  <td className="py-0.5 pr-2">
                    {l.label}
                    {l.quantity > 1 && (
                      <span className="text-muted-foreground">
                        {" "}
                        · {l.quantity} × {money(l.unitPence)}
                      </span>
                    )}
                  </td>
                  <td className="py-0.5 text-right tabular-nums">{money(l.totalPence)}</td>
                </tr>
              ))}
              {many && (
                <tr className="text-muted-foreground">
                  <td className="py-0.5 pr-2">Company total a month</td>
                  <td className="py-0.5 text-right tabular-nums">{money(c.monthlyPence)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ))}

      <table className="w-full border-t pt-2">
        <tbody>
          <Row label="A month" value={money(result.monthlySubtotalPence)} />
          {result.discountPence > 0 && (
            <Row
              label={`Deal discount (${result.discountPercent}%)`}
              value={`− ${money(result.discountPence)}`}
            />
          )}
          {yearly && (
            <>
              <Row label="× 12 months" value={money(result.monthlyNetPence * 12)} />
              {result.yearlyDiscountPence > 0 && (
                <Row
                  label={`Yearly discount (${result.yearlyDiscountPercent}%)`}
                  value={`− ${money(result.yearlyDiscountPence)}`}
                />
              )}
            </>
          )}
          <Row
            label={yearly ? "A year, before VAT" : "A month, before VAT"}
            value={money(result.periodNetPence)}
            strong
          />
          <Row
            label={`VAT (${result.vatRateBasisPoints / 100}%)`}
            value={money(result.vatPence)}
          />
          <Row
            label={yearly ? "A year, with VAT" : "A month, with VAT"}
            value={money(result.periodGrossPence)}
            strong
          />
        </tbody>
      </table>
    </div>
  );
}

function Row({ label, value, strong }) {
  return (
    <tr className={strong ? "font-semibold" : "text-muted-foreground"}>
      <td className="py-0.5 pr-2">{label}</td>
      <td className="py-0.5 text-right tabular-nums">{value}</td>
    </tr>
  );
}
