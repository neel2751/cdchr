"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import QuoteBreakdown from "@/components/pricing/quoteBreakdown";
import { FEATURES } from "@/data/features";
import { formatMoney } from "@/lib/money";
import { addOnsFor, quote } from "@/lib/pricing";
import { isFeatureEnabled, resolveFeatureDependencies } from "@/lib/tenantPlan";
import {
  applyPlanToCompany,
  getCompanyPricing,
} from "@/server/billingServer/pricingServer";
import {
  addCompanyToAccount,
  createAccount,
} from "@/server/billingServer/accountServer";

/**
 * Put one company on a package, at a price — worked out from what it really
 * uses today (people counted in this company only; see lib/pricing.js).
 *
 * Optionally switches its modules to the package's, and marks it as a paying
 * customer, which ends its free trial.
 */
export default function PriceTab({ tenant, run, isPending }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  // Reload when the company's billing changes — joining an account or
  // applying a package refreshes the page's company, not this tab's data.
  const billingStamp = `${tenant.billing?.accountId || ""}|${tenant.billing?.planAppliedAt || ""}`;

  useEffect(() => {
    let cancelled = false;
    getCompanyPricing(tenant._id).then((res) => {
      if (cancelled) return;
      if (!res?.success) setError(res?.message || "Could not load");
      else setData(JSON.parse(res.data));
    });
    return () => {
      cancelled = true;
    };
  }, [tenant._id, billingStamp]);

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!data) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Counting this company&apos;s people…
      </p>
    );
  }
  return <PriceForm tenant={tenant} data={data} run={run} isPending={isPending} />;
}

function PriceForm({ tenant, data, run, isPending }) {
  const { plans, settings, usage, billing } = data;
  const offered = plans.filter((p) => p.isActive !== false || p.key === billing.plan);
  const onPlan = plans.some((p) => p.key === billing.plan);

  const [planKey, setPlanKey] = useState(onPlan ? billing.plan : "");
  const [cycle, setCycle] = useState(billing.cycle || "monthly");
  const [discount, setDiscount] = useState(String(billing.discountPercent ?? 0));
  // Decided by the billing account, not here: an account's companies other
  // than its main one get the extra-company price (accountStore.js).
  const extraCompany = Boolean(data.extraCompany);
  const [addOns, setAddOns] = useState(billing.addOns || []);
  const [matchModules, setMatchModules] = useState(tenant.status === "trial");
  const [markPaying, setMarkPaying] = useState(tenant.status !== "active");

  const plan = plans.find((p) => p.key === planKey);
  const sellable = plan ? addOnsFor(plan, settings) : [];

  const result = useMemo(
    () =>
      quote({
        companies: [
          {
            label: tenant.name,
            planKey,
            officeStaff: usage.officeStaff,
            workers: usage.workers,
            storageGb: usage.storageGb || 0,
            addOns,
            extraCompany,
          },
        ],
        cycle,
        discountPercent: Number(discount),
        plans,
        settings,
      }),
    [planKey, usage, addOns, extraCompany, cycle, discount, plans, settings, tenant.name]
  );

  // What "match modules" would switch off that is on now — said before
  // saving, because it hides that module's records (nothing is deleted).
  const goingOff = (() => {
    if (!plan || !matchModules) return [];
    const wanted = new Set([...plan.features, ...addOns]);
    const resolved = resolveFeatureDependencies(
      Object.fromEntries(FEATURES.map((f) => [f.key, wanted.has(f.key)]))
    );
    return FEATURES.filter(
      (f) => isFeatureEnabled(tenant.features, f.key) && resolved[f.key] === false
    ).map((f) => f.label);
  })();

  const included = (key) => plan?.included?.[key];

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_24rem]">
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">What they use today</CardTitle>
            <p className="text-sm text-muted-foreground">
              Current people only, in this company. Leavers are not counted.{" "}
              {billing.overageMode === "block"
                ? "They chose to stop at the package's allowance."
                : "Over the allowance, extras are charged (their choice, on Plan & billing)."}
            </p>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-3">
            <Usage label="Office staff" value={usage.officeStaff} included={included("officeStaff")} />
            <Usage label="Students / workers" value={usage.workers} included={included("workers")} />
            <Usage
              label="Storage"
              value={usage.storageGb == null ? "unknown" : `${usage.storageGb} GB`}
              over={usage.storageGb != null && plan ? usage.storageGb > included("storageGb") : false}
              included={plan ? `${included("storageGb")} GB` : undefined}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Package and price</CardTitle>
            {billing.planAppliedAt && onPlan && (
              <p className="text-sm text-muted-foreground">
                On {plans.find((p) => p.key === billing.plan)?.name} since{" "}
                {new Date(billing.planAppliedAt).toLocaleDateString("en-GB")}, quoted at{" "}
                {formatMoney(billing.quotedMonthlyPence || 0)} a month before VAT.
              </p>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5 sm:col-span-3">
                <Label className="text-xs">Package</Label>
                <Select
                  value={planKey}
                  onValueChange={(k) => {
                    setPlanKey(k);
                    setAddOns([]);
                  }}
                >
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="Choose a package" />
                  </SelectTrigger>
                  <SelectContent>
                    {offered.map((p) => (
                      <SelectItem key={p.key} value={p.key}>
                        {p.name} — {formatMoney(p.monthlyPence)} a month
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Billing</Label>
                <Select value={cycle} onValueChange={setCycle}>
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="monthly">Monthly</SelectItem>
                    <SelectItem value="yearly">
                      Yearly ({settings.yearlyDiscountPercent}% off)
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="deal" className="text-xs">
                  Deal discount %
                </Label>
                <Input
                  id="deal"
                  type="number"
                  min="0"
                  max="100"
                  value={discount}
                  onChange={(e) => setDiscount(e.target.value)}
                  className="h-9"
                />
              </div>
            </div>

            <AccountLine
              tenant={tenant}
              account={data.account}
              accounts={data.accounts}
              extraCompany={extraCompany}
              discountPercent={settings.extraCompanyDiscountPercent}
              run={run}
              isPending={isPending}
            />

            {sellable.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Add-ons</p>
                <div className="grid gap-1 sm:grid-cols-2">
                  {sellable.map((a) => (
                    <label key={a.key} className="flex cursor-pointer items-center gap-2 text-sm">
                      <Checkbox
                        checked={addOns.includes(a.key)}
                        onCheckedChange={(on) =>
                          setAddOns((list) =>
                            on ? [...list, a.key] : list.filter((k) => k !== a.key)
                          )
                        }
                      />
                      {a.label}
                      <span className="text-muted-foreground">{formatMoney(a.pence)}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-3 border-t pt-4">
              <label className="flex cursor-pointer items-start gap-2 text-sm">
                <Checkbox
                  checked={matchModules}
                  onCheckedChange={(on) => setMatchModules(on === true)}
                  className="mt-0.5"
                />
                <span>
                  Switch modules to match the package
                  <span className="block text-xs text-muted-foreground">
                    Off: the modules stay as they are now (Plan tab).
                  </span>
                </span>
              </label>
              {goingOff.length > 0 && (
                <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-950 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
                  This switches off {goingOff.join(", ")}. Their records are
                  hidden, not deleted, and come back if switched on again.
                </p>
              )}
              <label className="flex cursor-pointer items-start gap-2 text-sm">
                <Checkbox
                  checked={markPaying}
                  onCheckedChange={(on) => setMarkPaying(on === true)}
                  className="mt-0.5"
                />
                <span>
                  Mark as a paying customer
                  <span className="block text-xs text-muted-foreground">
                    Ends the free trial. A lock set on the Access tab stays.
                  </span>
                </span>
              </label>
            </div>

            <Button
              disabled={isPending || !plan}
              onClick={() =>
                run(() =>
                  applyPlanToCompany(tenant._id, {
                    planKey,
                    cycle,
                    discountPercent: Number(discount),
                    addOns,
                    matchModules,
                    markPaying,
                  })
                )
              }
            >
              {isPending && <Loader2 className="size-4 animate-spin" />}
              Apply {plan ? plan.name : "package"}
              {plan ? ` at ${formatMoney(result.periodNetPence)}${cycle === "yearly" ? " a year" : " a month"}` : ""}
            </Button>
            <p className="text-xs text-muted-foreground">
              Prices and packages are set on the{" "}
              <Link href="/platform/pricing" className="underline underline-offset-2">
                Pricing
              </Link>{" "}
              page. Charging them starts with monthly invoicing (Step 5).
            </p>
          </CardContent>
        </Card>
      </div>

      <Card className="h-fit lg:sticky lg:top-4">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            Price
            {billing.trialOffer && (
              <Badge variant="outline">trial from {billing.trialOffer}</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <QuoteBreakdown result={result} />
        </CardContent>
      </Card>
    </div>
  );
}

function Usage({ label, value, included, over }) {
  const isOver =
    over ?? (typeof value === "number" && typeof included === "number" && value > included);
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tabular-nums">{value}</p>
      {included !== undefined && (
        <p className={`text-xs ${isOver ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground"}`}>
          {included} included{isOver ? " — over" : ""}
        </p>
      )}
    </div>
  );
}

/**
 * Which customer this company is billed under — and so whether it pays the
 * full package price or the extra-company one. Join an account, or start one
 * with this company as its main company.
 */
function AccountLine({ tenant, account, accounts, extraCompany, discountPercent, run, isPending }) {
  const [joinId, setJoinId] = useState("");
  if (account) {
    return (
      <div className="rounded-lg border p-3 text-sm">
        <p>
          Billed under{" "}
          <Link href={`/platform/accounts/${account._id}`} className="font-medium underline underline-offset-2">
            {account.name}
          </Link>{" "}
          with {account.companies.length - 1} other compan
          {account.companies.length - 1 === 1 ? "y" : "ies"}.
        </p>
        <p className="text-xs text-muted-foreground">
          {extraCompany
            ? `An extra company: its package price is ${discountPercent}% off. Its people are still counted here.`
            : "The account's main company: full package price."}
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-2 rounded-lg border p-3 text-sm">
      <p>
        Billed on its own.{" "}
        <span className="text-xs text-muted-foreground">
          A branch of an existing customer? Put it on their account for the
          extra-company price ({discountPercent}% off the package).
        </span>
      </p>
      <div className="flex flex-wrap gap-2">
        {accounts.length > 0 && (
          <>
            <Select value={joinId} onValueChange={setJoinId}>
              <SelectTrigger className="h-8 w-56">
                <SelectValue placeholder="Join an account" />
              </SelectTrigger>
              <SelectContent>
                {accounts.map((a) => (
                  <SelectItem key={a._id} value={a._id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              variant="outline"
              disabled={isPending || !joinId}
              onClick={() => run(() => addCompanyToAccount(joinId, tenant._id))}
            >
              Join
            </Button>
          </>
        )}
        <Button
          size="sm"
          variant="ghost"
          disabled={isPending}
          onClick={() =>
            run(() => createAccount({ name: tenant.name, companyIds: [tenant._id] }))
          }
        >
          Start an account with this company
        </Button>
      </div>
    </div>
  );
}
