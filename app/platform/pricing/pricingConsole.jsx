"use client";

import { useMemo, useState, useTransition } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Calculator,
  Copy,
  Gift,
  Loader2,
  Package,
  Plus,
  Receipt,
  Trash2,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import QuoteBreakdown from "@/components/pricing/quoteBreakdown";
import { FEATURES, FEATURE_GROUPS } from "@/data/features";
import { formatMoney, toDecimal, toPence } from "@/lib/money";
import { addOnsFor, offerUsable, quote } from "@/lib/pricing";
import {
  getPricing,
  savePlan,
  savePricingSettings,
  saveTrialOffer,
} from "@/server/billingServer/pricingServer";

/**
 * Plans & pricing (server/billingServer/pricingServer.js, lib/pricing.js).
 *
 * Money is typed in pounds and stored in pence: every input here holds the
 * pounds as typed, and converts on save.
 */
export default function PricingConsole() {
  const { data, error, refetch } = useQuery({
    queryKey: ["platformPricing"],
    queryFn: async () => {
      const res = await getPricing();
      if (!res?.success) throw new Error(res?.message || "Could not load");
      return JSON.parse(res.data);
    },
  });
  const load = () => refetch();

  if (error) return <p className="text-sm text-destructive">{error.message}</p>;
  if (!data) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Loading the price list…
      </p>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Plans &amp; pricing</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          The packages you sell, extra-person prices, add-ons, free trial length
          and offer codes. Put a company on a package from its own page.
        </p>
      </div>

      {!data.reviewed && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
          These are <strong>suggested</strong> prices to start from. Check each
          package, then save the <strong>Price list</strong> tab to confirm.
        </div>
      )}

      <Tabs defaultValue="plans">
        <TabsList className="mb-4 flex-wrap">
          <TabsTrigger value="plans" className="gap-2">
            <Package className="size-4" /> Packages
          </TabsTrigger>
          <TabsTrigger value="settings" className="gap-2">
            <Receipt className="size-4" /> Price list
          </TabsTrigger>
          <TabsTrigger value="offers" className="gap-2">
            <Gift className="size-4" /> Trial offers
          </TabsTrigger>
          <TabsTrigger value="quote" className="gap-2">
            <Calculator className="size-4" /> Quote calculator
          </TabsTrigger>
        </TabsList>

        <TabsContent value="plans">
          <PlansTab plans={data.plans} onSaved={load} />
        </TabsContent>
        <TabsContent value="settings">
          <SettingsTab settings={data.settings} onSaved={load} />
        </TabsContent>
        <TabsContent value="offers">
          <OffersTab
            offers={data.offers}
            trialDays={data.settings.trialDays}
            onSaved={load}
          />
        </TabsContent>
        <TabsContent value="quote">
          <QuoteCalculator plans={data.plans} settings={data.settings} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ------------------------------------------------------------- helpers */

const pounds = (pence) => String(toDecimal(pence || 0));

function useSave(onSaved) {
  const [isPending, startTransition] = useTransition();
  const save = (action) =>
    startTransition(async () => {
      const res = await action();
      if (res?.success) {
        toast.success(res.message || "Saved");
        await onSaved?.();
      } else {
        toast.error(res?.message || "Could not save");
      }
    });
  return { save, isPending };
}

function NumberField({ id, label, value, onChange, prefix, suffix, step = "1", hint }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      <div className="flex items-center gap-1.5">
        {prefix && <span className="text-sm text-muted-foreground">{prefix}</span>}
        <Input
          id={id}
          type="number"
          inputMode="decimal"
          min="0"
          step={step}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-9"
        />
        {suffix && <span className="text-sm text-muted-foreground">{suffix}</span>}
      </div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/* ------------------------------------------------------------ packages */

function PlansTab({ plans, onSaved }) {
  const [adding, setAdding] = useState(false);
  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-3">
        {plans.map((plan) => (
          <PlanEditor key={plan.key} plan={plan} onSaved={onSaved} />
        ))}
        {adding && (
          <PlanEditor
            isNew
            plan={{
              key: "",
              name: "",
              description: "",
              sortOrder: plans.length + 1,
              isActive: true,
              monthlyPence: 0,
              included: { officeStaff: 0, workers: 0, storageGb: 0 },
              extraPence: { officeStaff: 0, worker: 0, storageGb: 0 },
              features: [],
            }}
            onSaved={async () => {
              setAdding(false);
              await onSaved();
            }}
          />
        )}
      </div>
      {!adding && (
        <Button variant="outline" onClick={() => setAdding(true)}>
          <Plus className="size-4" /> Add a package
        </Button>
      )}
    </div>
  );
}

function PlanEditor({ plan, isNew = false, onSaved }) {
  const [v, setV] = useState(() => ({
    key: plan.key,
    name: plan.name,
    description: plan.description || "",
    sortOrder: plan.sortOrder || 0,
    isActive: plan.isActive !== false,
    monthly: pounds(plan.monthlyPence),
    incOffice: String(plan.included?.officeStaff ?? 0),
    incWorkers: String(plan.included?.workers ?? 0),
    incStorage: String(plan.included?.storageGb ?? 0),
    exOffice: pounds(plan.extraPence?.officeStaff),
    exWorker: pounds(plan.extraPence?.worker),
    exStorage: pounds(plan.extraPence?.storageGb),
    features: new Set(plan.features || []),
  }));
  const set = (k) => (val) => setV((s) => ({ ...s, [k]: val }));
  const { save, isPending } = useSave(onSaved);

  const toggle = (key, on) =>
    setV((s) => {
      const features = new Set(s.features);
      if (on) features.add(key);
      else features.delete(key);
      return { ...s, features };
    });

  const submit = () =>
    save(() =>
      savePlan({
        isNew,
        key: v.key,
        name: v.name,
        description: v.description,
        sortOrder: v.sortOrder,
        isActive: v.isActive,
        monthlyPence: toPence(v.monthly),
        included: {
          officeStaff: Number(v.incOffice),
          workers: Number(v.incWorkers),
          storageGb: Number(v.incStorage),
        },
        extraPence: {
          officeStaff: toPence(v.exOffice),
          worker: toPence(v.exWorker),
          storageGb: toPence(v.exStorage),
        },
        features: [...v.features],
      })
    );

  return (
    <Card className={v.isActive ? "" : "opacity-70"}>
      <CardHeader className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base">
            {v.name || "New package"}
            {!v.isActive && (
              <Badge variant="outline" className="ml-2">
                not offered
              </Badge>
            )}
          </CardTitle>
          <div className="flex items-center gap-2">
            <Label htmlFor={`active-${plan.key || "new"}`} className="text-xs">
              Offered
            </Label>
            <Switch
              id={`active-${plan.key || "new"}`}
              checked={v.isActive}
              onCheckedChange={set("isActive")}
            />
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs" htmlFor={`name-${plan.key || "new"}`}>
              Name
            </Label>
            <Input
              id={`name-${plan.key || "new"}`}
              value={v.name}
              onChange={(e) => set("name")(e.target.value)}
              className="h-9"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs" htmlFor={`key-${plan.key || "new"}`}>
              Key {isNew ? "" : "(fixed)"}
            </Label>
            <Input
              id={`key-${plan.key || "new"}`}
              value={v.key}
              disabled={!isNew}
              placeholder="e.g. starter"
              onChange={(e) => set("key")(e.target.value.toLowerCase())}
              className="h-9"
            />
          </div>
        </div>
        <Input
          value={v.description}
          onChange={(e) => set("description")(e.target.value)}
          placeholder="One line about who it is for"
          className="h-9"
          aria-label="Description"
        />
      </CardHeader>

      <CardContent className="space-y-5">
        <NumberField
          id={`monthly-${plan.key}`}
          label="Package price a month"
          prefix="£"
          step="0.01"
          value={v.monthly}
          onChange={set("monthly")}
        />

        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Included
          </p>
          <div className="grid grid-cols-3 gap-2">
            <NumberField id={`io-${plan.key}`} label="Office staff" value={v.incOffice} onChange={set("incOffice")} />
            <NumberField id={`iw-${plan.key}`} label="Students / workers" value={v.incWorkers} onChange={set("incWorkers")} />
            <NumberField id={`is-${plan.key}`} label="Storage" suffix="GB" value={v.incStorage} onChange={set("incStorage")} />
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Each one over, a month
          </p>
          <div className="grid grid-cols-3 gap-2">
            <NumberField id={`eo-${plan.key}`} label="Office staff" prefix="£" step="0.01" value={v.exOffice} onChange={set("exOffice")} />
            <NumberField id={`ew-${plan.key}`} label="Student / worker" prefix="£" step="0.01" value={v.exWorker} onChange={set("exWorker")} />
            <NumberField id={`es-${plan.key}`} label="GB" prefix="£" step="0.01" value={v.exStorage} onChange={set("exStorage")} />
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Modules included
          </p>
          {FEATURE_GROUPS.map((group) => (
            <div key={group} className="space-y-1">
              <p className="text-xs text-muted-foreground">{group}</p>
              <div className="grid grid-cols-2 gap-1">
                {FEATURES.filter((f) => f.group === group).map((f) => (
                  <label
                    key={f.key}
                    className="flex cursor-pointer items-center gap-2 text-sm"
                  >
                    <Checkbox
                      checked={v.features.has(f.key)}
                      onCheckedChange={(on) => toggle(f.key, on === true)}
                    />
                    {f.label}
                  </label>
                ))}
              </div>
            </div>
          ))}
          <p className="text-xs text-muted-foreground">
            Clocking in, attendance, staff records and the rest of the core are
            in every package.
          </p>
        </div>

        <Button onClick={submit} disabled={isPending} className="w-full">
          {isPending && <Loader2 className="size-4 animate-spin" />}
          {isNew ? "Add package" : `Save ${v.name || "package"}`}
        </Button>
      </CardContent>
    </Card>
  );
}

/* ----------------------------------------------------------- price list */

function SettingsTab({ settings, onSaved }) {
  const [v, setV] = useState(() => ({
    yearly: String(settings.yearlyDiscountPercent ?? 0),
    extraCompany: String(settings.extraCompanyDiscountPercent ?? 0),
    vat: String((settings.vatRateBasisPoints ?? 2000) / 100),
    trialDays: String(settings.trialDays ?? 14),
    addOns: Object.fromEntries(
      FEATURES.map((f) => [f.key, pounds(settings.addOnPence?.[f.key])])
    ),
  }));
  const set = (k) => (val) => setV((s) => ({ ...s, [k]: val }));
  const { save, isPending } = useSave(onSaved);

  const submit = () =>
    save(() =>
      savePricingSettings({
        yearlyDiscountPercent: Number(v.yearly),
        extraCompanyDiscountPercent: Number(v.extraCompany),
        vatRateBasisPoints: Math.round(Number(v.vat) * 100),
        trialDays: Number(v.trialDays),
        addOnPence: Object.fromEntries(
          Object.entries(v.addOns).map(([k, p]) => [k, toPence(p)])
        ),
      })
    );

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Discounts, VAT and trial</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <NumberField
            id="yearly"
            label="Yearly billing discount"
            suffix="%"
            value={v.yearly}
            onChange={set("yearly")}
            hint="Off twelve months, when paid yearly."
          />
          <NumberField
            id="extraCompany"
            label="Extra company / branch discount"
            suffix="%"
            value={v.extraCompany}
            onChange={set("extraCompany")}
            hint="Off the package price of a customer's second and later company."
          />
          <NumberField
            id="vat"
            label="VAT"
            suffix="%"
            step="0.01"
            value={v.vat}
            onChange={set("vat")}
          />
          <NumberField
            id="trialDays"
            label="Free trial"
            suffix="days"
            value={v.trialDays}
            onChange={set("trialDays")}
            hint="For sign-ups without an offer code. Codes can give longer."
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Add-on modules</CardTitle>
          <p className="text-sm text-muted-foreground">
            A month, for a module bought on top of a package that does not
            include it. £0 means it is not sold on its own.
          </p>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          {FEATURES.map((f) => (
            <NumberField
              key={f.key}
              id={`addon-${f.key}`}
              label={f.label}
              prefix="£"
              step="0.01"
              value={v.addOns[f.key]}
              onChange={(val) =>
                setV((s) => ({ ...s, addOns: { ...s.addOns, [f.key]: val } }))
              }
            />
          ))}
        </CardContent>
      </Card>

      <div className="lg:col-span-2">
        <Button onClick={submit} disabled={isPending}>
          {isPending && <Loader2 className="size-4 animate-spin" />}
          Save price list
        </Button>
      </div>
    </div>
  );
}

/* --------------------------------------------------------- trial offers */

const blankOffer = { code: "", label: "", trialDays: "30", validUntil: "", maxUses: "" };

function OffersTab({ offers, trialDays, onSaved }) {
  const [form, setForm] = useState(blankOffer);
  const [editing, setEditing] = useState(null);
  const { save, isPending } = useSave(async () => {
    setForm(blankOffer);
    setEditing(null);
    await onSaved();
  });
  const set = (k) => (e) => setForm((s) => ({ ...s, [k]: e.target.value }));

  const linkFor = (code) =>
    typeof window === "undefined" ? "" : `${window.location.origin}/signup?offer=${code}`;
  const copy = (text) =>
    navigator.clipboard.writeText(text).then(() => toast.success("Link copied"));

  const submit = (e) => {
    e.preventDefault();
    save(() =>
      saveTrialOffer({
        ...form,
        isNew: !editing,
        isActive: editing ? editing.isActive : true,
      })
    );
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Offer codes</CardTitle>
          <p className="text-sm text-muted-foreground">
            Without a code a free trial is {trialDays} days. Hand out a code —
            or its signup link — at an event to give longer.
          </p>
        </CardHeader>
        <CardContent>
          {offers.length === 0 ? (
            <p className="text-sm text-muted-foreground">No offer codes yet.</p>
          ) : (
            <ul className="divide-y">
              {offers.map((o) => {
                const live = offerUsable(o);
                return (
                  <li key={o.code} className="flex flex-wrap items-center gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2 font-mono text-sm font-medium">
                        {o.code}
                        <Badge variant={live ? "secondary" : "outline"} className="font-sans">
                          {o.trialDays} days
                        </Badge>
                        {!live && (
                          <Badge variant="outline" className="font-sans">
                            {o.isActive === false ? "switched off" : "ended"}
                          </Badge>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {o.label || "No description"} · used {o.uses || 0}
                        {o.maxUses ? ` of ${o.maxUses}` : ""} time
                        {(o.uses || 0) === 1 ? "" : "s"}
                        {o.validUntil
                          ? ` · until ${new Date(o.validUntil).toLocaleDateString("en-GB")}`
                          : ""}
                      </p>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => copy(linkFor(o.code))}>
                      <Copy className="size-4" /> Link
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setEditing(o);
                        setForm({
                          code: o.code,
                          label: o.label || "",
                          trialDays: String(o.trialDays),
                          validUntil: o.validUntil ? o.validUntil.slice(0, 10) : "",
                          maxUses: o.maxUses ? String(o.maxUses) : "",
                        });
                      }}
                    >
                      Edit
                    </Button>
                    <Switch
                      aria-label={`${o.code} on or off`}
                      checked={o.isActive !== false}
                      disabled={isPending}
                      onCheckedChange={(on) =>
                        save(() =>
                          saveTrialOffer({
                            code: o.code,
                            label: o.label,
                            trialDays: o.trialDays,
                            validFrom: o.validFrom,
                            validUntil: o.validUntil,
                            maxUses: o.maxUses,
                            isActive: on,
                          })
                        )
                      }
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {editing ? `Edit ${editing.code}` : "New offer code"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="offer-code" className="text-xs">
                Code
              </Label>
              <Input
                id="offer-code"
                value={form.code}
                disabled={Boolean(editing)}
                placeholder="EXPO30"
                onChange={(e) =>
                  setForm((s) => ({ ...s, code: e.target.value.toUpperCase() }))
                }
                className="h-9 font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="offer-label" className="text-xs">
                What it is for
              </Label>
              <Input
                id="offer-label"
                value={form.label}
                placeholder="Construction Expo 2026"
                onChange={set("label")}
                className="h-9"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="offer-days" className="text-xs">
                  Free trial (days)
                </Label>
                <Input
                  id="offer-days"
                  type="number"
                  min="1"
                  max="365"
                  value={form.trialDays}
                  onChange={set("trialDays")}
                  className="h-9"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="offer-max" className="text-xs">
                  Max sign-ups
                </Label>
                <Input
                  id="offer-max"
                  type="number"
                  min="0"
                  placeholder="No limit"
                  value={form.maxUses}
                  onChange={set("maxUses")}
                  className="h-9"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="offer-until" className="text-xs">
                Last day it works (optional)
              </Label>
              <Input
                id="offer-until"
                type="date"
                value={form.validUntil}
                onChange={set("validUntil")}
                className="h-9"
              />
            </div>
            <div className="flex gap-2">
              <Button type="submit" disabled={isPending}>
                {isPending && <Loader2 className="size-4 animate-spin" />}
                {editing ? "Save" : "Create code"}
              </Button>
              {editing && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setEditing(null);
                    setForm(blankOffer);
                  }}
                >
                  Cancel
                </Button>
              )}
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

/* ----------------------------------------------------------- calculator */

const blankCompany = (plans, i) => ({
  label: i === 0 ? "Main company" : `Branch ${i}`,
  planKey: plans.find((p) => p.isActive !== false)?.key || "",
  officeStaff: "10",
  workers: "0",
  storageGb: "1",
  addOns: [],
});

function QuoteCalculator({ plans, settings }) {
  const offered = plans.filter((p) => p.isActive !== false);
  const [cycle, setCycle] = useState("monthly");
  const [discount, setDiscount] = useState("0");
  const [companies, setCompanies] = useState(() => [blankCompany(offered, 0)]);

  const update = (i, patch) =>
    setCompanies((list) => list.map((c, j) => (j === i ? { ...c, ...patch } : c)));

  const result = useMemo(
    () =>
      quote({
        companies: companies.map((c) => ({
          ...c,
          officeStaff: Number(c.officeStaff),
          workers: Number(c.workers),
          storageGb: Number(c.storageGb),
        })),
        cycle,
        discountPercent: Number(discount),
        plans,
        settings,
      }),
    [companies, cycle, discount, plans, settings]
  );

  const copyText = () => {
    const money = (p) => formatMoney(p, result.currency);
    const lines = result.companies.flatMap((c) => [
      `${c.label} — ${c.planName || "no package"}`,
      ...c.lines.map(
        (l) =>
          `  ${l.label}${l.quantity > 1 ? ` (${l.quantity} × ${money(l.unitPence)})` : ""}: ${money(l.totalPence)}`
      ),
    ]);
    const text = [
      ...lines,
      result.discountPence ? `Deal discount ${result.discountPercent}%: −${money(result.discountPence)}` : null,
      result.yearlyDiscountPence
        ? `Yearly discount ${result.yearlyDiscountPercent}%: −${money(result.yearlyDiscountPence)}`
        : null,
      `${result.cycle === "yearly" ? "A year" : "A month"}: ${money(result.periodNetPence)} + VAT ${money(result.vatPence)} = ${money(result.periodGrossPence)}`,
    ]
      .filter(Boolean)
      .join("\n");
    navigator.clipboard.writeText(text).then(() => toast.success("Quote copied"));
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_24rem]">
      <div className="space-y-4">
        <Card>
          <CardContent className="grid gap-4 pt-6 sm:grid-cols-2">
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
            <NumberField
              id="deal"
              label="Deal discount"
              suffix="%"
              value={discount}
              onChange={setDiscount}
            />
          </CardContent>
        </Card>

        {companies.map((c, i) => {
          const plan = plans.find((p) => p.key === c.planKey);
          const addOns = plan ? addOnsFor(plan, settings) : [];
          return (
            <Card key={i}>
              <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
                <Input
                  value={c.label}
                  onChange={(e) => update(i, { label: e.target.value })}
                  className="h-8 max-w-56 font-medium"
                  aria-label="Company name"
                />
                <div className="flex items-center gap-2">
                  {i > 0 && (
                    <Badge variant="secondary">
                      {settings.extraCompanyDiscountPercent}% off package
                    </Badge>
                  )}
                  {i > 0 && (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Remove"
                      onClick={() => setCompanies((list) => list.filter((_, j) => j !== i))}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-4">
                  <div className="space-y-1.5 sm:col-span-4">
                    <Label className="text-xs">Package</Label>
                    <Select
                      value={c.planKey}
                      onValueChange={(planKey) => update(i, { planKey, addOns: [] })}
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
                  <NumberField
                    id={`q-office-${i}`}
                    label="Office staff"
                    value={c.officeStaff}
                    onChange={(val) => update(i, { officeStaff: val })}
                    hint={plan ? `${plan.included.officeStaff} included` : ""}
                  />
                  <NumberField
                    id={`q-workers-${i}`}
                    label="Students / workers"
                    value={c.workers}
                    onChange={(val) => update(i, { workers: val })}
                    hint={plan ? `${plan.included.workers} included` : ""}
                  />
                  <NumberField
                    id={`q-storage-${i}`}
                    label="Storage"
                    suffix="GB"
                    step="0.1"
                    value={c.storageGb}
                    onChange={(val) => update(i, { storageGb: val })}
                    hint={plan ? `${plan.included.storageGb} GB included` : ""}
                  />
                </div>
                {addOns.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Add-ons</p>
                    <div className="grid gap-1 sm:grid-cols-2">
                      {addOns.map((a) => (
                        <label key={a.key} className="flex cursor-pointer items-center gap-2 text-sm">
                          <Checkbox
                            checked={c.addOns.includes(a.key)}
                            onCheckedChange={(on) =>
                              update(i, {
                                addOns: on
                                  ? [...c.addOns, a.key]
                                  : c.addOns.filter((k) => k !== a.key),
                              })
                            }
                          />
                          {a.label}
                          <span className="text-muted-foreground">
                            {formatMoney(a.pence)}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}

        <Button
          variant="outline"
          onClick={() =>
            setCompanies((list) => [...list, blankCompany(offered, list.length)])
          }
        >
          <Plus className="size-4" /> Add another company or branch
        </Button>
      </div>

      <Card className="h-fit lg:sticky lg:top-4">
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Quote</CardTitle>
          <Button variant="ghost" size="sm" onClick={copyText}>
            <Copy className="size-4" /> Copy
          </Button>
        </CardHeader>
        <CardContent>
          <QuoteBreakdown result={result} />
        </CardContent>
      </Card>
    </div>
  );
}
