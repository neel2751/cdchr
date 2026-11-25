"use client";

import { useEffect, useState } from "react";
import { CreditCard, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { getMyInvoices } from "@/server/billingServer/invoices";
import { createInvoiceCheckout } from "@/server/billingServer/stripe";
import { finishCardSetup, startCardSetup } from "@/server/billingServer/cardServer";

/**
 * The unpaid bills of a locked company, each with a button to pay it on
 * Stripe's page — for the super admin, on /account-paused. Paying reopens the
 * company as soon as Stripe confirms it (billingServer/paymentLocks.js).
 */
export default function PayNow({ justPaid, cardSessionId = "" }) {
  const [invoices, setInvoices] = useState(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [cardNote, setCardNote] = useState(cardSessionId ? "Saving your card…" : "");

  // Back from Stripe with a new card: save it, which also pays what is owed
  // with it (billingServer/cardStore.js) — and so reopens the account.
  useEffect(() => {
    if (!cardSessionId) return;
    finishCardSetup({ sessionId: cardSessionId }).then((res) => {
      setCardNote(res?.message || "The card was not saved");
      if (res?.success) setTimeout(() => window.location.assign("/account-paused"), 2500);
    });
  }, [cardSessionId]);

  useEffect(() => {
    getMyInvoices().then((res) => {
      if (!res?.success) return setInvoices([]);
      setInvoices(
        JSON.parse(res.data).filter((i) => i.outstandingPence > 0 && i.status !== "void")
      );
    });
  }, []);

  if (cardNote) {
    return (
      <p className="rounded-md border p-3 text-sm">{cardNote}</p>
    );
  }
  if (justPaid) {
    return (
      <p className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100">
        Thank you — payment for {justPaid} received. Your account reopens as soon
        as the bank confirms it, usually within a minute.{" "}
        <a href="/account-paused" className="font-medium underline underline-offset-2">
          Check again
        </a>
      </p>
    );
  }
  if (invoices === null) {
    return (
      <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Looking for unpaid bills…
      </p>
    );
  }
  if (!invoices.length) return null;

  const pay = async (invoice) => {
    setBusy(invoice._id);
    setError("");
    try {
      const res = await createInvoiceCheckout({
        id: invoice._id,
        returnUrl: `${window.location.origin}/account-paused`,
      });
      if (!res?.success) return setError(res?.message || "Could not start the payment");
      window.location.assign(JSON.parse(res.data).url);
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="space-y-2 text-left">
      <p className="text-center font-medium">Unpaid bills</p>
      {invoices.map((inv) => (
        <div
          key={inv._id}
          className="flex items-center justify-between gap-3 rounded-lg border p-3"
        >
          <span>
            <span className="block font-medium">{inv.number}</span>
            <span className="block text-xs text-muted-foreground">
              {inv.outstandingFormatted} · due{" "}
              {inv.dueAt ? new Date(inv.dueAt).toLocaleDateString("en-GB") : "now"}
            </span>
          </span>
          <Button size="sm" disabled={!!busy} onClick={() => pay(inv)}>
            {busy === inv._id ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <CreditCard className="size-4" />
            )}
            Pay now
          </Button>
        </div>
      ))}
      <Button
        variant="outline"
        size="sm"
        className="w-full"
        disabled={!!busy}
        onClick={async () => {
          setBusy("card");
          setError("");
          try {
            const res = await startCardSetup({
              returnUrl: `${window.location.origin}/account-paused`,
            });
            if (!res?.success) return setError(res?.message || "Could not open the card page");
            window.location.assign(JSON.parse(res.data).url);
          } finally {
            setBusy("");
          }
        }}
      >
        {busy === "card" ? <Loader2 className="size-4 animate-spin" /> : <CreditCard className="size-4" />}
        Pay with a new card
      </Button>
      {error && <p className="text-center text-xs text-destructive">{error}</p>}
    </div>
  );
}
