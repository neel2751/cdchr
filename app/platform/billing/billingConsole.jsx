"use client";

import React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Ban, Check, FileText, Loader2, Receipt, Send } from "lucide-react";
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
import { Switch } from "@/components/ui/switch";
import { useFetchSelectQuery } from "@/hooks/use-query";
import { toPence } from "@/lib/money";
import {
  createCreditNote,
  draftInvoiceForOrder,
  getAllInvoices,
  issueInvoice,
  recordInvoicePayment,
  voidInvoice,
} from "@/server/billingServer/invoices";
import {
  getStripeAccount,
  reconcileInvoicePayment,
  saveStripeAccount,
} from "@/server/billingServer/stripe";

const STATUS_STYLE = {
  draft: "bg-neutral-100 text-neutral-600",
  issued: "bg-sky-100 text-sky-800",
  "part-paid": "bg-amber-100 text-amber-800",
  paid: "bg-green-100 text-green-800",
  void: "bg-neutral-100 text-neutral-400 line-through",
};

/**
 * Invoicing, from our side.
 *
 * The buttons are deliberately asymmetric: a draft can be changed and thrown
 * away, and an issued invoice can only be paid, voided or credited. That is
 * the accounting rule made visible rather than enforced silently and
 * explained in an error message afterwards.
 */
export default function BillingConsole() {
  const queryClient = useQueryClient();
  const { data: invoices = [], isLoading } = useFetchSelectQuery({
    queryKey: ["allInvoices"],
    fetchFn: getAllInvoices,
  });
  const { data: stripe } = useFetchSelectQuery({
    queryKey: ["stripeAccount"],
    fetchFn: getStripeAccount,
  });

  const [orderNumber, setOrderNumber] = React.useState("");
  const [stripeKey, setStripeKey] = React.useState("");

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["allInvoices"] });
    queryClient.invalidateQueries({ queryKey: ["stripeAccount"] });
  };

  const run = (promise) =>
    promise.then((res) => {
      if (!res?.success) {
        toast.error(res?.message || "That did not work");
        return;
      }
      toast.success(res.message);
      refresh();
    });

  const { mutate: act, isPending } = useMutation({
    mutationFn: ({ kind, ...args }) => {
      if (kind === "draft")
        return run(draftInvoiceForOrder(args)).then(() => setOrderNumber(""));
      if (kind === "issue") return run(issueInvoice(args));
      if (kind === "pay") return run(recordInvoicePayment(args));
      if (kind === "void") return run(voidInvoice(args));
      if (kind === "credit") return run(createCreditNote(args));
      if (kind === "reconcile") return run(reconcileInvoicePayment(args));
      if (kind === "stripe")
        return run(saveStripeAccount(args)).then(() => setStripeKey(""));
      return Promise.resolve();
    },
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Card payments (Stripe)</CardTitle>
          <CardDescription>
            Customers pay on Stripe&apos;s own hosted page. No card number ever
            reaches this application — that is what keeps it out of PCI scope,
            and it is not a decision to revisit casually.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label htmlFor="sk" className="text-xs">
                Secret key{" "}
                {stripe?.hint ? (
                  <span className="ml-1 font-mono text-muted-foreground">
                    {stripe.hint}
                  </span>
                ) : null}
              </Label>
              <Input
                id="sk"
                type="password"
                autoComplete="off"
                className="w-72"
                placeholder={
                  stripe?.configured ? "Leave blank to keep the stored key" : "sk_live_…"
                }
                value={stripeKey}
                disabled={isPending || !stripe?.sealingReady}
                onChange={(e) => setStripeKey(e.target.value)}
              />
            </div>
            <Button
              disabled={isPending || !stripe?.sealingReady}
              onClick={() => act({ kind: "stripe", secretKey: stripeKey })}
            >
              Save key
            </Button>
            <div className="flex items-center gap-2 pb-2">
              <Label className="text-xs" htmlFor="stripe-on">
                Enabled
              </Label>
              <Switch
                id="stripe-on"
                checked={Boolean(stripe?.isEnabled)}
                disabled={isPending || !stripe?.configured}
                onCheckedChange={(v) => act({ kind: "stripe", isEnabled: v })}
              />
            </div>
          </div>
          {!stripe?.sealingReady ? (
            <p className="text-xs text-red-600">
              TAG_KEY_MASTER is not set, so the key cannot be sealed.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Invoices</CardTitle>
          <CardDescription>
            A draft can be changed or thrown away. An issued invoice cannot —
            the customer has a copy, so a correction is a credit note.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input
              className="w-64"
              placeholder="Order number, e.g. TAG-260925-A1B2"
              value={orderNumber}
              onChange={(e) => setOrderNumber(e.target.value)}
            />
            <Button
              variant="outline"
              disabled={isPending || !orderNumber.trim()}
              onClick={() =>
                act({ kind: "draft", orderNumber: orderNumber.trim() })
              }
            >
              <Receipt className="mr-1 size-4" />
              Draft invoice
            </Button>
          </div>

          {isLoading ? (
            <div className="flex h-16 items-center justify-center">
              <Loader2 className="size-6 animate-spin text-neutral-400" />
            </div>
          ) : !invoices.length ? (
            <p className="text-sm text-muted-foreground">
              Nothing invoiced yet.
            </p>
          ) : (
            <div className="space-y-2">
              {invoices.map((inv) => (
                <div
                  key={inv._id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded border px-3 py-2 text-sm"
                >
                  <span className="flex flex-wrap items-center gap-2">
                    <FileText className="size-4 text-neutral-400" />
                    <span className="font-medium">
                      {inv.number || "(draft)"}
                    </span>
                    <span
                      className={`rounded px-1.5 py-0.5 text-[11px] ${
                        STATUS_STYLE[inv.status] || ""
                      }`}
                    >
                      {inv.status}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {inv.companyName} · {inv.orderNumber}
                    </span>
                    {inv.overdue ? (
                      <span className="text-[11px] font-medium text-red-600">
                        overdue
                      </span>
                    ) : null}
                  </span>

                  <span className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-medium">{inv.grossFormatted}</span>
                    {inv.outstandingPence > 0 && inv.status !== "draft" ? (
                      <span className="text-muted-foreground">
                        {inv.outstandingFormatted} owed
                      </span>
                    ) : null}

                    {inv.status === "draft" ? (
                      <Button
                        size="sm"
                        className="h-7"
                        disabled={isPending}
                        onClick={() => act({ kind: "issue", id: inv._id })}
                      >
                        <Send className="mr-1 size-3.5" />
                        Issue
                      </Button>
                    ) : null}

                    {inv.outstandingPence > 0 &&
                    inv.status !== "void" &&
                    inv.kind === "invoice" ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7"
                        disabled={isPending}
                        onClick={() => {
                          const typed = window.prompt(
                            `How much was received against ${inv.number}? (£, up to ${inv.outstandingFormatted})`,
                          );
                          if (typed === null) return;
                          act({
                            kind: "pay",
                            id: inv._id,
                            amountPence: toPence(typed),
                            reference:
                              window.prompt("Bank reference (optional)") || "",
                          });
                        }}
                      >
                        <Check className="mr-1 size-3.5" />
                        Record payment
                      </Button>
                    ) : null}

                    {inv.stripeSessionId && inv.outstandingPence > 0 ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7"
                        disabled={isPending}
                        title="Ask Stripe whether that checkout was actually paid"
                        onClick={() => act({ kind: "reconcile", id: inv._id })}
                      >
                        Check Stripe
                      </Button>
                    ) : null}

                    {inv.status !== "void" && inv.kind === "invoice" ? (
                      <>
                        {inv.paidPence === 0 ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7"
                            disabled={isPending}
                            onClick={() => {
                              const reason = window.prompt(
                                `Void ${inv.number || "this draft"}? The number is kept, so the sequence has no gap.`,
                              );
                              if (reason === null) return;
                              act({ kind: "void", id: inv._id, reason });
                            }}
                          >
                            <Ban className="mr-1 size-3.5" />
                            Void
                          </Button>
                        ) : null}
                        {inv.status !== "draft" ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7"
                            disabled={isPending}
                            onClick={() => {
                              const reason = window.prompt(
                                `Raise a credit note against ${inv.number}?`,
                              );
                              if (reason === null) return;
                              act({ kind: "credit", id: inv._id, reason });
                            }}
                          >
                            Credit
                          </Button>
                        ) : null}
                      </>
                    ) : null}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
