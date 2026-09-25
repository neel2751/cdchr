"use client";

import React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Download, Loader2, Lock, Unlock } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useFetchSelectQuery } from "@/hooks/use-query";
import {
  exportLedger,
  getAgedDebtors,
  getVatSummary,
  lockLedgerUpTo,
  setVatBasis,
} from "@/server/billingServer/ledger";

/**
 * Figures for whoever keeps the books.
 *
 * Says plainly what it is not, because the gap between "a VAT summary for our
 * hardware sales" and "our accounts" is where somebody would otherwise fill in
 * the difference with an assumption.
 */
export default function LedgerPanel() {
  const queryClient = useQueryClient();
  const { data: debtors, isLoading } = useFetchSelectQuery({
    queryKey: ["agedDebtors"],
    fetchFn: getAgedDebtors,
  });

  const quarterStart = new Date();
  quarterStart.setMonth(Math.floor(quarterStart.getMonth() / 3) * 3, 1);

  const [from, setFrom] = React.useState(
    quarterStart.toISOString().slice(0, 10),
  );
  const [to, setTo] = React.useState(new Date().toISOString().slice(0, 10));
  const [vat, setVat] = React.useState(null);

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["agedDebtors"] });

  const { mutate: runVat, isPending: vatting } = useMutation({
    mutationFn: (basis) =>
      getVatSummary({ from, to, basis }).then((res) => {
        if (!res?.success) {
          toast.error(res?.message || "Could not build that summary");
          return;
        }
        setVat(JSON.parse(res.data));
      }),
  });

  const { mutate: download, isPending: exporting } = useMutation({
    mutationFn: (shape) =>
      exportLedger({ from, to, shape }).then((res) => {
        if (!res?.success) {
          toast.error(res?.message || "Could not build that export");
          return;
        }
        const { csv, filename, balanced } = JSON.parse(res.data);
        // A journal that does not balance is said loudly rather than left for
        // whoever imports it to discover.
        if (balanced) toast.success(res.message);
        else toast.error(res.message);

        const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        link.click();
        URL.revokeObjectURL(url);
      }),
  });

  const { mutate: act, isPending: acting } = useMutation({
    mutationFn: ({ kind, ...args }) => {
      const call = kind === "lock" ? lockLedgerUpTo(args) : setVatBasis(args);
      return call.then((res) => {
        if (!res?.success) {
          toast.error(res?.message || "That did not work");
          return;
        }
        toast.success(res.message);
        refresh();
        setVat(null);
      });
    },
  });

  const busy = vatting || exporting || acting;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Who owes us money</CardTitle>
          <CardDescription>
            Aged from each invoice&apos;s due date, not its issue date — ageing
            from issue makes a punctual customer on 30-day terms look a month
            late the day they get the invoice.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex h-16 items-center justify-center">
              <Loader2 className="size-6 animate-spin text-neutral-400" />
            </div>
          ) : !debtors?.rows?.length ? (
            <p className="text-sm text-muted-foreground">Nothing outstanding.</p>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-3 text-xs">
                {debtors.buckets.map((b) => (
                  <div
                    key={b.key}
                    className={`rounded border px-3 py-2 ${
                      b.key === "90+" && b.totalPence > 0
                        ? "border-red-300 bg-red-50"
                        : ""
                    }`}
                  >
                    <p className="text-muted-foreground">{b.label}</p>
                    <p className="text-sm font-semibold">{b.totalFormatted}</p>
                  </div>
                ))}
                <div className="rounded border border-neutral-400 px-3 py-2">
                  <p className="text-muted-foreground">Total owed</p>
                  <p className="text-sm font-semibold">
                    {debtors.totalFormatted}
                  </p>
                </div>
              </div>

              <div className="space-y-1">
                {debtors.rows.map((r) => (
                  <div
                    key={r.tenantId}
                    className="flex items-center justify-between rounded border px-3 py-1.5 text-sm"
                  >
                    <span>{r.companyName}</span>
                    <span className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span>{r.invoices.length} invoice(s)</span>
                      <span className="text-sm font-medium text-foreground">
                        {r.totalFormatted}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">VAT and exports</CardTitle>
          <CardDescription>
            Hardware sales only. This is not a set of accounts — it knows
            nothing about the bank, payroll or purchases — so the figures go to
            whoever keeps the books rather than replacing them. Nothing here is
            filed with HMRC.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label htmlFor="from" className="text-xs">
                From
              </Label>
              <Input
                id="from"
                type="date"
                className="w-40"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="to" className="text-xs">
                To
              </Label>
              <Input
                id="to"
                type="date"
                className="w-40"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </div>
            <Button disabled={busy} onClick={() => runVat()}>
              {vatting ? (
                <Loader2 className="mr-1 size-4 animate-spin" />
              ) : null}
              VAT summary
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => download("invoices")}
            >
              <Download className="mr-1 size-4" />
              Invoices CSV
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => download("journal")}
            >
              <Download className="mr-1 size-4" />
              Journal CSV
            </Button>
          </div>

          {vat ? (
            <div className="space-y-2 rounded-md border p-3">
              <div className="flex flex-wrap items-center gap-4 text-sm">
                <span>
                  <span className="text-xs text-muted-foreground">
                    Box 1 — VAT on sales
                  </span>
                  <br />
                  <strong>{vat.box1Formatted}</strong>
                </span>
                <span>
                  <span className="text-xs text-muted-foreground">
                    Box 6 — net sales
                  </span>
                  <br />
                  <strong>{vat.box6Formatted}</strong>
                </span>
                <span className="text-xs text-muted-foreground">
                  {vat.count} document(s), {vat.basis} basis
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2 border-t pt-2">
                <span className="text-xs text-muted-foreground">
                  Basis — a decision made with HMRC, not by software:
                </span>
                {vat.bases.map((b) => (
                  <Button
                    key={b.value}
                    size="sm"
                    variant={vat.basis === b.value ? "default" : "outline"}
                    className="h-7 text-xs"
                    disabled={busy}
                    onClick={() => {
                      act({ kind: "basis", basis: b.value });
                      runVat(b.value);
                    }}
                  >
                    {b.label.split(" — ")[0]}
                  </Button>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground">
                {vat.basis === "cash"
                  ? "VAT falls in the period a payment is received, apportioned across part payments."
                  : "VAT falls in the period an invoice is issued, whether or not it has been paid."}{" "}
                A credit note reduces the period it was raised in, not the one
                it corrects — you adjust the current return rather than
                restating a filed one.
              </p>
            </div>
          ) : null}

          <div className="space-y-1 rounded-md border border-dashed p-3">
            <p className="text-sm font-medium">Closing a period</p>
            <p className="text-xs text-muted-foreground">
              Once a return is filed, the figures behind it must stop moving.
              Locking refuses any change dated on or before that day — voiding
              an old invoice, crediting one, backdating a payment.
              {vat?.lockedUpTo
                ? ` Currently closed up to ${new Date(vat.lockedUpTo)
                    .toISOString()
                    .slice(0, 10)}.`
                : " Nothing is closed."}
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => act({ kind: "lock", date: to })}
              >
                <Lock className="mr-1 size-3.5" />
                Close up to {to}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  if (
                    !window.confirm(
                      "Re-open every closed period? Figures behind a filed return could then change.",
                    )
                  )
                    return;
                  act({ kind: "lock", date: null });
                }}
              >
                <Unlock className="mr-1 size-3.5" />
                Re-open
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
