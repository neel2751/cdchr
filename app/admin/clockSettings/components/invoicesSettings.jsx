"use client";

import React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useFetchSelectQuery } from "@/hooks/use-query";
import { getMyInvoices } from "@/server/billingServer/invoices";
import {
  createInvoiceCheckout,
  stripeAvailable,
} from "@/server/billingServer/stripe";

const STATUS_STYLE = {
  issued: "bg-sky-100 text-sky-800",
  "part-paid": "bg-amber-100 text-amber-800",
  paid: "bg-green-100 text-green-800",
  void: "bg-neutral-100 text-neutral-500 line-through",
};

/**
 * A company's own invoices.
 *
 * Read-only by design. Nothing here can change an invoice, because an issued
 * invoice cannot be changed by anybody — a correction is a credit note, and
 * raising one is ours.
 */
export default function InvoicesSettings() {
  const queryClient = useQueryClient();
  const { data: invoices = [], isLoading } = useFetchSelectQuery({
    queryKey: ["myInvoices"],
    fetchFn: getMyInvoices,
  });
  const { data: cardState } = useFetchSelectQuery({
    queryKey: ["stripeAvailable"],
    fetchFn: stripeAvailable,
  });

  const { mutate: pay, isPending } = useMutation({
    mutationFn: (id) =>
      createInvoiceCheckout({
        id,
        returnUrl:
          typeof window !== "undefined" ? window.location.href : undefined,
      }).then((res) => {
        if (!res?.success) {
          toast.error(res?.message || "Could not start that payment");
          return;
        }
        const { url } = JSON.parse(res.data);
        queryClient.invalidateQueries({ queryKey: ["myInvoices"] });
        // Stripe's own page, on Stripe's domain. No card field has ever
        // existed in this application and none should.
        window.location.href = url;
      }),
  });

  const canPayByCard = Boolean(cardState?.available);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Invoices</CardTitle>
        <CardDescription>
          For hardware orders. Everything else on your plan is billed
          separately.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex h-16 items-center justify-center">
            <Loader2 className="size-6 animate-spin text-neutral-400" />
          </div>
        ) : !invoices.length ? (
          <p className="text-sm text-neutral-500">Nothing invoiced yet.</p>
        ) : (
          <div className="space-y-2">
            {invoices.map((inv) => (
              <div
                key={inv._id}
                className="flex flex-wrap items-center justify-between gap-2 rounded border px-3 py-2 text-sm"
              >
                <span className="flex items-center gap-2">
                  <FileText className="size-4 text-neutral-400" />
                  <span className="font-medium">{inv.number}</span>
                  <span
                    className={`rounded px-1.5 py-0.5 text-[11px] ${
                      STATUS_STYLE[inv.status] || ""
                    }`}
                  >
                    {inv.status}
                  </span>
                  {inv.overdue ? (
                    <span className="text-[11px] font-medium text-red-600">
                      overdue
                    </span>
                  ) : null}
                  {inv.kind === "credit-note" ? (
                    <span className="text-[11px] text-neutral-500">
                      credit note
                    </span>
                  ) : null}
                </span>

                <span className="flex items-center gap-3 text-xs text-neutral-600">
                  <span>
                    {inv.grossFormatted}
                    {inv.outstandingPence > 0 &&
                    inv.outstandingPence !== inv.grossPence ? (
                      <span className="ml-1 text-neutral-500">
                        ({inv.outstandingFormatted} left)
                      </span>
                    ) : null}
                  </span>
                  {inv.dueAt ? (
                    <span>
                      due {new Date(inv.dueAt).toLocaleDateString("en-GB")}
                    </span>
                  ) : null}
                  {canPayByCard &&
                  inv.outstandingPence > 0 &&
                  inv.kind === "invoice" &&
                  inv.status !== "void" ? (
                    <Button
                      size="sm"
                      className="h-7"
                      disabled={isPending}
                      onClick={() => pay(inv._id)}
                    >
                      Pay by card
                      <ExternalLink className="ml-1 size-3" />
                    </Button>
                  ) : null}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
