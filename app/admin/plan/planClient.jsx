"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import QuoteBreakdown from "@/components/pricing/quoteBreakdown";
import { formatMoney } from "@/lib/money";
import { getMyPlan, setOverageMode } from "@/server/billingServer/myPlanServer";
import InvoicesSettings from "../clockSettings/components/invoicesSettings";

const KEY = ["myPlan"];

/**
 * Plan & billing (server/billingServer/myPlanServer.js): the package, a live
 * price from today's headcount, a bar per allowance, the over-the-allowance
 * choice, the packages to compare, and invoices.
 */
export default function PlanClient() {
  const { data, error, isLoading } = useQuery({
    queryKey: KEY,
    queryFn: async () => {
      const res = await getMyPlan();
      if (!res?.success) throw new Error(res?.message || "Could not load");
      return JSON.parse(res.data);
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Counting your people…
      </div>
    );
  }
  if (error) return <p className="p-6 text-sm text-destructive">{error.message}</p>;

  const money = (p) => formatMoney(p, data.currency);
  const onTrial = data.access?.reason === "trial" || data.access?.reason === "trialEnded";

  return (
    <div className="space-y-5 p-4 md:p-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Plan &amp; billing</h1>
        <p className="mt-1 text-sm text-muted-foreground">{data.companyName}</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                {data.plan ? `${data.plan.name} package` : "No package yet"}
                {onTrial && <Badge variant="secondary">Free trial</Badge>}
                {data.plan && (
                  <Badge variant="outline">
                    {data.cycle === "yearly" ? "Billed yearly" : "Billed monthly"}
                  </Badge>
                )}
              </CardTitle>
              <CardDescription>
                {data.access?.text ||
                  (data.plan
                    ? data.plan.description
                    : "Choose a package below — we will set it up for you.")}
              </CardDescription>
              {data.addOns.length > 0 && (
                <p className="text-sm text-muted-foreground">
                  Add-ons: {data.addOns.join(", ")}
                </p>
              )}
            </CardHeader>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">What you use</CardTitle>
              <CardDescription>
                Current people only — leavers and anyone switched off are not
                counted.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {data.rows.map((row) => (
                <UsageBar key={row.key} row={row} money={money} overageMode={data.overageMode} />
              ))}
            </CardContent>
          </Card>

          {data.plan && <OverageChoice mode={data.overageMode} plan={data.plan} money={money} workersLabel={data.workersLabel} />}

          <Packages packages={data.packages} money={money} contactEmail={data.contactEmail} />
        </div>

        <Card className="h-fit lg:sticky lg:top-4">
          <CardHeader>
            <CardTitle className="text-base">Your price</CardTitle>
            <CardDescription>
              At today&apos;s numbers. Each bill uses the numbers on the day.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {data.quote ? (
              <QuoteBreakdown result={data.quote} />
            ) : (
              <p className="text-sm text-muted-foreground">
                Your price appears here once you are on a package.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <InvoicesSettings />
    </div>
  );
}

const BAR_TONE = {
  ok: "",
  near: "bg-amber-500",
  over: "bg-sky-600",
  full: "bg-red-600",
  unknown: "",
};

function UsageBar({ row, money, overageMode }) {
  const unit = row.unit ? ` ${row.unit}` : "";
  const against = row.included ?? row.cap;
  const used = row.used == null ? "—" : `${row.used}${unit}`;

  let note = "";
  if (row.state === "unknown") note = "Could not be measured just now.";
  else if (against == null) note = "No allowance — unlimited.";
  else if (row.state === "full") {
    note =
      row.cap != null && row.used >= row.cap
        ? `The most this company can have. Contact us to raise it.`
        : `Your package's allowance, and you chose to stop here.`;
  } else if (row.over > 0) {
    note = `${row.over}${unit} over the ${row.included}${unit} included — ${money(row.overPence)} extra a month.`;
  } else if (row.included != null) {
    const left = row.included - (row.unit ? Math.ceil(row.used) : row.used);
    note =
      overageMode === "block"
        ? `${left}${unit} left in your package.`
        : `${left}${unit} left before extras at ${money(row.extraPence)} each.`;
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="font-medium">{row.label}</span>
        <span className="tabular-nums text-muted-foreground">
          {used}
          {against != null ? ` of ${against}${unit}` : ""}
        </span>
      </div>
      <Progress
        value={row.percent == null ? 0 : Math.min(100, row.percent)}
        className="h-2"
        progressClassName={BAR_TONE[row.state] || ""}
        aria-label={`${row.label}: ${used}${against != null ? ` of ${against}${unit}` : ""}`}
      />
      <p
        className={`text-xs ${
          row.state === "full"
            ? "text-red-700 dark:text-red-400"
            : row.state === "near"
              ? "text-amber-700 dark:text-amber-400"
              : "text-muted-foreground"
        }`}
      >
        {note}
      </p>
    </div>
  );
}

function OverageChoice({ mode, plan, money, workersLabel }) {
  const queryClient = useQueryClient();
  const [value, setValue] = useState(mode);
  const [saving, setSaving] = useState(false);

  const save = async (next) => {
    setValue(next);
    setSaving(true);
    try {
      const res = await setOverageMode(next);
      if (res?.success) {
        toast.success(res.message);
        await queryClient.invalidateQueries({ queryKey: KEY });
      } else {
        toast.error(res?.message || "Could not save that");
        setValue(mode);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          When you go over your package
          {saving && <Loader2 className="size-4 animate-spin" />}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <RadioGroup value={value} onValueChange={save} className="gap-3" disabled={saving}>
          <Label
            htmlFor="overage-charge"
            className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 font-normal"
          >
            <RadioGroupItem id="overage-charge" value="charge" className="mt-0.5" />
            <span className="space-y-0.5">
              <span className="block font-medium">Keep going, and pay for extras</span>
              <span className="block text-xs text-muted-foreground">
                Add as many people as you need. Each one over is on the next
                bill: {money(plan.extraPence.officeStaff)} per office staff
                member, {money(plan.extraPence.worker)} per{" "}
                {workersLabel.toLowerCase().replace(/s$/, "")}, a month.
              </span>
            </span>
          </Label>
          <Label
            htmlFor="overage-block"
            className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 font-normal"
          >
            <RadioGroupItem id="overage-block" value="block" className="mt-0.5" />
            <span className="space-y-0.5">
              <span className="block font-medium">Stop at my package&apos;s allowance</span>
              <span className="block text-xs text-muted-foreground">
                No surprises on the bill: once the allowance is reached, no
                more people or files can be added until the package changes.
                You are warned at 80%.
              </span>
            </span>
          </Label>
        </RadioGroup>
      </CardContent>
    </Card>
  );
}

function Packages({ packages, money, contactEmail }) {
  if (!packages.length) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Packages</CardTitle>
        <CardDescription>
          To start or change a package,{" "}
          {contactEmail ? (
            <a
              className="underline underline-offset-2"
              href={`mailto:${contactEmail}?subject=${encodeURIComponent("Our package")}`}
            >
              email {contactEmail}
            </a>
          ) : (
            "contact us"
          )}
          .
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-3">
        {packages.map((p) => (
          <div
            key={p.key}
            className={`space-y-2 rounded-lg border p-3 ${p.current ? "border-primary ring-1 ring-primary" : ""}`}
          >
            <div className="flex items-center justify-between gap-2">
              <p className="font-medium">{p.name}</p>
              {p.current && <Badge>Yours</Badge>}
            </div>
            <p className="text-lg font-semibold tabular-nums">
              {money(p.monthlyPence)}
              <span className="text-xs font-normal text-muted-foreground"> a month</span>
            </p>
            {p.description && <p className="text-xs text-muted-foreground">{p.description}</p>}
            <ul className="space-y-0.5 text-xs">
              <li>{p.included.officeStaff} office staff</li>
              <li>{p.included.workers} students / workers</li>
              <li>{p.included.storageGb} GB storage</li>
            </ul>
            <ul className="space-y-0.5 text-xs text-muted-foreground">
              {p.modules.map((m) => (
                <li key={m} className="flex items-center gap-1">
                  <Check className="size-3 shrink-0" /> {m}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
