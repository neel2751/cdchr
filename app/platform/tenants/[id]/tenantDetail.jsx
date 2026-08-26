"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowLeft,
  BadgeCheck,
  Copy,
  Globe,
  Loader2,
  Palette,
  Plus,
  ShieldAlert,
  SlidersHorizontal,
  Star,
  Trash2,
  Users,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  platformAddDomain,
  platformRemoveDomain,
  platformSetPrimaryDomain,
  platformUpdateBranding,
  platformUpdateSlug,
  platformVerifyDomain,
  setTenantStatus,
  updateTenantPlan,
} from "@/server/tenantServer/platformServer";

const STATUS_VARIANT = {
  active: "default",
  trial: "secondary",
  suspended: "destructive",
  cancelled: "outline",
};

const FEATURE_LABELS = {
  crm: "CRM",
  expenses: "Expenses",
  visitors: "Visitors",
  siteProjects: "Site projects",
  documents: "Documents",
  devices: "Devices",
  ai: "AI",
};

const TenantDetail = ({ tenant }) => {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const run = (action, after) =>
    startTransition(async () => {
      const res = await action();
      if (res?.success) {
        toast.success(res.message || "Saved");
        after?.();
        router.refresh();
      } else {
        toast.error(res?.message || "Something went wrong");
      }
    });

  return (
    <div className="space-y-5">
      <Link
        href="/platform"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        All companies
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{tenant.name}</h1>
          <p className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
            <Badge variant={STATUS_VARIANT[tenant.status] || "outline"}>
              {tenant.status}
            </Badge>
            <span className="flex items-center gap-1">
              <Users className="size-3.5" />
              {tenant.employeeCount} employees
            </span>
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {tenant.status !== "suspended" ? (
            <Button
              variant="destructive"
              disabled={isPending}
              onClick={() => run(() => setTenantStatus(tenant._id, "suspended"))}
            >
              Suspend
            </Button>
          ) : (
            <Button
              disabled={isPending}
              onClick={() => run(() => setTenantStatus(tenant._id, "active"))}
            >
              Reactivate
            </Button>
          )}
        </div>
      </div>

      {tenant.status === "suspended" && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
          Suspended — this company&apos;s domains no longer resolve and its users
          cannot sign in.
        </div>
      )}

      <Tabs defaultValue="branding">
        <TabsList className="mb-4">
          <TabsTrigger value="branding" className="gap-2">
            <Palette className="size-4" />
            Branding
          </TabsTrigger>
          <TabsTrigger value="domains" className="gap-2">
            <Globe className="size-4" />
            Domains
          </TabsTrigger>
          <TabsTrigger value="plan" className="gap-2">
            <SlidersHorizontal className="size-4" />
            Plan
          </TabsTrigger>
        </TabsList>

        <TabsContent value="branding">
          <BrandingTab tenant={tenant} run={run} isPending={isPending} />
        </TabsContent>
        <TabsContent value="domains">
          <DomainsTab tenant={tenant} run={run} isPending={isPending} />
        </TabsContent>
        <TabsContent value="plan">
          <PlanTab tenant={tenant} run={run} isPending={isPending} />
        </TabsContent>
      </Tabs>
    </div>
  );
};

const BrandingTab = ({ tenant, run, isPending }) => {
  const [v, setV] = useState(() => ({
    appName: tenant.storedBranding?.appName || "",
    logoUrl: tenant.storedBranding?.logoUrl || "",
    supportEmail: tenant.storedBranding?.supportEmail || "",
    emailFromName: tenant.storedBranding?.emailFromName || "",
    primaryColor: tenant.storedBranding?.primaryColor || "",
  }));
  const set = (k, val) => setV((s) => ({ ...s, [k]: val }));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Branding</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        {[
          ["appName", "Application name", "Acme People"],
          ["logoUrl", "Logo URL", "https://…/logo.svg"],
          ["supportEmail", "Support email", "support@acme.com"],
          ["emailFromName", "Email sender name", "Acme HR"],
          ["primaryColor", "Primary colour", "oklch(0.55 0.21 258)"],
        ].map(([key, label, placeholder]) => (
          <div key={key} className="space-y-1.5">
            <Label htmlFor={`b-${key}`}>{label}</Label>
            <Input
              id={`b-${key}`}
              value={v[key]}
              placeholder={placeholder}
              onChange={(e) => set(key, e.target.value)}
            />
          </div>
        ))}
        <div className="md:col-span-2">
          <Button
            disabled={isPending}
            onClick={() => run(() => platformUpdateBranding(tenant._id, v))}
          >
            {isPending && <Loader2 className="size-4 animate-spin" />}
            Save branding
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

const DomainsTab = ({ tenant, run, isPending }) => {
  const [host, setHost] = useState("");
  const [slug, setSlug] = useState(tenant.slug || "");
  const copy = (t) => {
    navigator.clipboard.writeText(t);
    toast.success("Copied");
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Workspace address</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-2">
          <div className="space-y-1.5">
            <Label htmlFor="p-slug">Address</Label>
            <div className="flex items-center gap-1">
              <Input
                id="p-slug"
                value={slug}
                className="w-48"
                onChange={(e) => setSlug(e.target.value)}
              />
              <span className="text-sm text-muted-foreground">
                .{tenant.platformRootDomain || "your-platform-domain.com"}
              </span>
            </div>
          </div>
          <Button
            variant="outline"
            disabled={isPending || !slug || slug === tenant.slug}
            onClick={() => run(() => platformUpdateSlug(tenant._id, slug))}
          >
            Save
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Custom domains</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="p-host">Add a domain</Label>
              <Input
                id="p-host"
                value={host}
                placeholder="hr.acme.com"
                className="w-72"
                onChange={(e) => setHost(e.target.value)}
              />
            </div>
            <Button
              disabled={isPending || !host.trim()}
              onClick={() =>
                run(
                  () => platformAddDomain(tenant._id, host),
                  () => setHost("")
                )
              }
            >
              <Plus className="size-4" />
              Add
            </Button>
          </div>

          {tenant.domains.length === 0 ? (
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              No domains yet.
            </div>
          ) : (
            <ul className="divide-y rounded-lg border">
              {tenant.domains.map((d) => (
                <li key={d.host} className="space-y-3 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{d.host}</span>
                      {d.isPrimary && (
                        <Badge variant="outline" className="gap-1">
                          <Star className="size-3" />
                          Primary
                        </Badge>
                      )}
                      {d.verified ? (
                        <Badge className="gap-1">
                          <BadgeCheck className="size-3" />
                          Verified
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="gap-1">
                          <ShieldAlert className="size-3" />
                          Unverified
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {!d.verified && (
                        <Button
                          size="sm"
                          disabled={isPending}
                          onClick={() =>
                            run(() => platformVerifyDomain(tenant._id, d.host))
                          }
                        >
                          Verify
                        </Button>
                      )}
                      {d.verified && !d.isPrimary && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={isPending}
                          onClick={() =>
                            run(() =>
                              platformSetPrimaryDomain(tenant._id, d.host)
                            )
                          }
                        >
                          Make primary
                        </Button>
                      )}
                      <Button
                        size="icon"
                        variant="outline"
                        disabled={isPending}
                        aria-label={`Remove ${d.host}`}
                        onClick={() =>
                          run(() => platformRemoveDomain(tenant._id, d.host))
                        }
                      >
                        <Trash2 className="size-4 text-rose-600" />
                      </Button>
                    </div>
                  </div>

                  {!d.verified && (
                    <div className="rounded-md bg-muted/50 p-3 text-xs">
                      <p className="mb-2 font-medium">
                        Publish this TXT record, then press Verify:
                      </p>
                      <div className="grid gap-2 sm:grid-cols-[auto_1fr]">
                        <span className="text-muted-foreground">Name</span>
                        <CopyRow value={`_verify.${d.host}`} onCopy={copy} />
                        <span className="text-muted-foreground">Value</span>
                        <CopyRow value={d.verificationToken} onCopy={copy} />
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

const PlanTab = ({ tenant, run, isPending }) => {
  const [plan, setPlan] = useState(tenant.billing?.plan || "standard");
  const [seats, setSeats] = useState(tenant.billing?.seats ?? "");
  const [features, setFeatures] = useState(() => {
    const base = {};
    for (const key of Object.keys(FEATURE_LABELS)) {
      base[key] = tenant.features?.[key] !== false;
    }
    return base;
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Plan and features</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="plan">Plan</Label>
            <Input
              id="plan"
              value={plan}
              onChange={(e) => setPlan(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="seats">Seats</Label>
            <Input
              id="seats"
              type="number"
              min="1"
              value={seats}
              placeholder="unlimited"
              onChange={(e) => setSeats(e.target.value)}
            />
          </div>
        </div>

        <div>
          <p className="mb-2 text-sm font-medium">Modules</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {Object.entries(FEATURE_LABELS).map(([key, label]) => (
              <label
                key={key}
                className="flex items-center justify-between rounded-md border p-2.5 text-sm"
              >
                <span>{label}</span>
                <Switch
                  checked={features[key]}
                  onCheckedChange={(checked) =>
                    setFeatures((f) => ({ ...f, [key]: checked }))
                  }
                />
              </label>
            ))}
          </div>
        </div>

        <Button
          disabled={isPending}
          onClick={() =>
            run(() =>
              updateTenantPlan(tenant._id, {
                plan,
                seats: seats === "" ? null : seats,
                features,
              })
            )
          }
        >
          {isPending && <Loader2 className="size-4 animate-spin" />}
          Save plan
        </Button>
      </CardContent>
    </Card>
  );
};

const CopyRow = ({ value, onCopy }) => (
  <span className="flex items-center gap-2">
    <code className="min-w-0 flex-1 truncate rounded bg-background px-2 py-1 font-mono">
      {value}
    </code>
    <button
      type="button"
      onClick={() => onCopy(value)}
      className="shrink-0 rounded p-1 text-muted-foreground hover:bg-background hover:text-foreground"
      aria-label="Copy"
    >
      <Copy className="size-3.5" />
    </button>
  </span>
);

export default TenantDetail;
