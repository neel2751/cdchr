"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CreditCard, Loader2, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  finishCardSetup,
  getMyPayment,
  removeMyCard,
  setMyPaymentMethod,
  startCardSetup,
} from "@/server/billingServer/cardServer";

const KEY = ["myPayment"];

/**
 * How the company pays (server/billingServer/cardServer.js): the saved card,
 * charged for each bill, or an invoice to pay. The card is typed on Stripe's
 * page — this screen never sees it.
 */
export default function PaymentCard() {
  const router = useRouter();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState("");
  const finished = useRef(false);

  const { data, isLoading } = useQuery({
    queryKey: KEY,
    queryFn: async () => {
      const res = await getMyPayment();
      if (!res?.success) throw new Error(res?.message || "Could not load");
      return JSON.parse(res.data);
    },
  });

  // Back from Stripe's page with a card saved: keep it, then tidy the URL.
  const sessionId = params.get("session_id");
  const cardResult = params.get("card");
  useEffect(() => {
    if (finished.current) return;
    if (cardResult === "done" && sessionId) {
      finished.current = true;
      finishCardSetup({ sessionId }).then(async (res) => {
        if (res?.success) toast.success(res.message);
        else toast.error(res?.message || "The card was not saved");
        await queryClient.invalidateQueries({ queryKey: KEY });
        router.replace("/admin/plan");
      });
    } else if (cardResult === "cancelled") {
      finished.current = true;
      router.replace("/admin/plan");
    }
  }, [cardResult, sessionId, queryClient, router]);

  const act = async (name, action, after) => {
    setBusy(name);
    try {
      const res = await action();
      if (!res?.success) return toast.error(res?.message || "Something went wrong");
      if (after) return after(res);
      toast.success(res.message);
      await queryClient.invalidateQueries({ queryKey: KEY });
    } finally {
      setBusy("");
    }
  };

  const addCard = () =>
    act(
      "add",
      () => startCardSetup({ returnUrl: `${window.location.origin}/admin/plan` }),
      (res) => window.location.assign(JSON.parse(res.data).url)
    );

  if (isLoading || !data) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 pt-6 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading how you pay…
        </CardContent>
      </Card>
    );
  }

  if (!data.canManage) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">How you pay</CardTitle>
          <CardDescription>
            Your bill is paid by {data.mainCompany || "your main company"}, on one
            bill for all your companies. Its super admin manages the card.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const card = data.card;
  const exp = card?.expMonth
    ? `${String(card.expMonth).padStart(2, "0")}/${String(card.expYear).slice(-2)}`
    : "";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          How you pay
          {busy && <Loader2 className="size-4 animate-spin" />}
        </CardTitle>
        <CardDescription>
          {data.nextBillAt
            ? `Next bill on ${new Date(data.nextBillAt).toLocaleDateString("en-GB", {
                day: "numeric",
                month: "long",
                year: "numeric",
              })}.`
            : data.onPlan
              ? "Your first bill is made when billing starts."
              : "Your bills start once you are on a package."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {data.cardFailedAt && (
          <div className="flex items-start gap-2 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-950 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            <span>
              Your last card payment on{" "}
              {new Date(data.cardFailedAt).toLocaleDateString("en-GB")} did not go
              through: {data.cardFailure}. Pay the invoice below, or add a new card.
            </span>
          </div>
        )}

        {card ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
            <span className="flex items-center gap-2 text-sm">
              <CreditCard className="size-4" />
              <span className="capitalize">{card.brand}</span> ending {card.last4}
              {exp && <span className="text-muted-foreground">· expires {exp}</span>}
            </span>
            <span className="flex gap-2">
              <Button size="sm" variant="outline" disabled={!!busy || !data.stripeReady} onClick={addCard}>
                Replace
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={!!busy}
                onClick={() => act("remove", () => removeMyCard())}
              >
                Remove
              </Button>
            </span>
          </div>
        ) : (
          <div className="space-y-2 rounded-lg border border-dashed p-3 text-sm">
            <p>
              No card saved. Save one and each bill is paid automatically — nothing
              to remember.
            </p>
            {data.stripeReady ? (
              <Button size="sm" disabled={!!busy} onClick={addCard}>
                <CreditCard className="size-4" /> Add a card
              </Button>
            ) : (
              <p className="text-xs text-muted-foreground">
                Card payment is not switched on yet — your bills come as invoices.
              </p>
            )}
          </div>
        )}

        <RadioGroup
          value={data.paymentMethod}
          onValueChange={(method) => act("method", () => setMyPaymentMethod(method))}
          className="gap-3"
          disabled={!!busy}
        >
          <Label
            htmlFor="pay-card"
            className={`flex items-start gap-3 rounded-lg border p-3 font-normal ${card ? "cursor-pointer" : "opacity-60"}`}
          >
            <RadioGroupItem id="pay-card" value="card" disabled={!card} className="mt-0.5" />
            <span className="space-y-0.5">
              <span className="block font-medium">Charge my card for each bill</span>
              <span className="block text-xs text-muted-foreground">
                Paid on the day it is made. You get a receipt by email.
              </span>
            </span>
          </Label>
          <Label
            htmlFor="pay-invoice"
            className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 font-normal"
          >
            <RadioGroupItem id="pay-invoice" value="invoice" className="mt-0.5" />
            <span className="space-y-0.5">
              <span className="block font-medium">Send me an invoice</span>
              <span className="block text-xs text-muted-foreground">
                Pay each one by card or bank transfer before it is due.
              </span>
            </span>
          </Label>
        </RadioGroup>
      </CardContent>
    </Card>
  );
}
