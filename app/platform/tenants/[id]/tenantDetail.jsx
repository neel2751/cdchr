"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useSession } from "next-auth/react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
  UserPlus,
  Download,
  AlertTriangle,
  Eye,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  listSupportSessions,
  startSupportSession,
} from "@/server/tenantServer/supportServer";
import {
  deleteTenantPermanently,
  exportTenant,
  previewTenantDeletion,
} from "@/server/tenantServer/lifecycleServer";
import {
  grantMembership,
  listTenantMembers,
  revokeMembership,
} from "@/server/tenantServer/membershipServer";
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
          <SupportVisitButton tenant={tenant} />
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
          <TabsTrigger value="members" className="gap-2">
            <Users className="size-4" />
            Members
          </TabsTrigger>
          <TabsTrigger value="danger" className="gap-2">
            <AlertTriangle className="size-4" />
            Data
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
        <TabsContent value="members">
          <MembersTab tenant={tenant} run={run} isPending={isPending} />
        </TabsContent>
        <TabsContent value="danger">
          <DataTab tenant={tenant} run={run} isPending={isPending} />
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
  const [storageMb, setStorageMb] = useState(
    tenant.limits?.maxStorageBytes
      ? Math.round(tenant.limits.maxStorageBytes / (1024 * 1024))
      : ""
  );
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
          <div className="space-y-1.5">
            <Label htmlFor="storage">Storage allowance (MB)</Label>
            <Input
              id="storage"
              type="number"
              min="1"
              value={storageMb}
              placeholder="unlimited"
              onChange={(e) => setStorageMb(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {tenant.storage
                ? `${(tenant.storage.bytes / (1024 * 1024)).toFixed(1)} MB in use across ${tenant.storage.objects} files`
                : "Current usage unavailable"}
            </p>
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
                limits: {
                  maxStorageBytes:
                    storageMb === "" ? null : Number(storageMb) * 1024 * 1024,
                },
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

/**
 * Who can act as this company.
 *
 * This is what lets one login own several companies: granting an existing
 * account access here makes the company appear in that person's switcher.
 */
const MembersTab = ({ tenant, run, isPending }) => {
  const [members, setMembers] = useState([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("superAdmin");

  useEffect(() => {
    let alive = true;
    (async () => {
      const res = await listTenantMembers(tenant._id);
      if (alive && res?.success) setMembers(JSON.parse(res.data));
    })();
    return () => {
      alive = false;
    };
  }, [tenant._id, isPending]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Members</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Give an existing account access to this company. It then appears in
          their company switcher and they can manage its settings themselves.
        </p>

        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1.5">
            <Label htmlFor="m-email">Account email</Label>
            <Input
              id="m-email"
              value={email}
              placeholder="person@example.com"
              className="w-72"
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="m-role">Role</Label>
            <select
              id="m-role"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="h-9 rounded-md border bg-transparent px-3 text-sm"
            >
              <option value="superAdmin">superAdmin</option>
              <option value="admin">admin</option>
              <option value="user">user</option>
            </select>
          </div>
          <Button
            disabled={isPending || !email.trim()}
            onClick={() =>
              run(
                () => grantMembership(tenant._id, email, role),
                () => setEmail("")
              )
            }
          >
            <UserPlus className="size-4" />
            Grant access
          </Button>
        </div>

        {members.length === 0 ? (
          <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            No members yet.
          </div>
        ) : (
          <ul className="divide-y rounded-lg border">
            {members.map((m) => (
              <li
                key={m._id}
                className="flex flex-wrap items-center justify-between gap-3 p-3"
              >
                <span className="flex items-center gap-2 text-sm">
                  {m.email}
                  <Badge variant="outline">{m.role}</Badge>
                  {m.isDefault && <Badge variant="secondary">default</Badge>}
                </span>
                <Button
                  size="icon"
                  variant="outline"
                  disabled={isPending}
                  aria-label={`Remove ${m.email}`}
                  onClick={() => run(() => revokeMembership(tenant._id, m.userId))}
                >
                  <Trash2 className="size-4 text-rose-600" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
};

/**
 * Export and permanent deletion.
 *
 * Deletion is deliberately awkward: the company must already be suspended, the
 * name has to be typed exactly, and the export sits directly above it — there
 * is nothing to export afterwards.
 */
/**
 * Open a read-only look at this company's data.
 *
 * A reason is required because it is written into the company's audit trail,
 * and the visit expires on its own.
 */
const SupportVisitButton = ({ tenant }) => {
  const { update } = useSession();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [minutes, setMinutes] = useState(30);
  const [isPending, startPending] = useTransition();

  const start = () =>
    startPending(async () => {
      const res = await startSupportSession(tenant._id, reason, minutes);
      if (!res?.success) return toast.error(res?.message || "Could not start");
      // The session is switched by the server from the record it just wrote.
      await update({ refreshSupport: true });
      toast.success(res.message);
      window.location.assign("/admin/dashboard");
    });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Eye className="size-4" />
          View data
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Read-only support session</DialogTitle>
          <DialogDescription>
            Opens {tenant.name}&apos;s data as they see it. Every change is
            blocked, and this is recorded against their company.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="reason">Reason</Label>
            <Input
              id="reason"
              value={reason}
              placeholder="Investigating ticket #123"
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="minutes">Minutes (5-120)</Label>
            <Input
              id="minutes"
              type="number"
              min="5"
              max="120"
              value={minutes}
              className="w-32"
              onChange={(e) => setMinutes(e.target.value)}
            />
          </div>
          <Button
            className="w-full"
            disabled={isPending || reason.trim().length < 5}
            onClick={start}
          >
            {isPending && <Loader2 className="size-4 animate-spin" />}
            Start read-only session
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

const DataTab = ({ tenant, run, isPending }) => {
  const [confirm, setConfirm] = useState("");
  const [preview, setPreview] = useState(null);
  const [busy, startBusy] = useTransition();

  useEffect(() => {
    let alive = true;
    (async () => {
      const res = await previewTenantDeletion(tenant._id);
      if (alive && res?.success) setPreview(JSON.parse(res.data));
    })();
    return () => { alive = false; };
  }, [tenant._id, isPending]);

  const download = () =>
    startBusy(async () => {
      const res = await exportTenant(tenant._id);
      if (!res?.success) return toast.error(res?.message || "Export failed");
      const blob = new Blob([res.data], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${tenant.slug || tenant._id}-export.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(res.message);
    });

  const deletable = tenant.status === "suspended" || tenant.status === "cancelled";

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Export</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Every document this company owns, as JSON. Take one before deleting.
          </p>
          {preview && (
            <p className="text-sm">
              <strong>{preview.total}</strong> documents across{" "}
              {Object.keys(preview.counts).length} collections.
            </p>
          )}
          <Button variant="outline" disabled={busy} onClick={download}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
            Download export
          </Button>
        </CardContent>
      </Card>

      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="text-base text-destructive">
            Delete permanently
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Removes the company and everything it owns. This cannot be undone.
          </p>
          {!deletable ? (
            <p className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
              Suspend this company first. Deleting a live company is never a
              single step.
            </p>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="confirm">
                  Type <strong>{tenant.name}</strong> to confirm
                </Label>
                <Input
                  id="confirm"
                  value={confirm}
                  className="max-w-sm"
                  onChange={(e) => setConfirm(e.target.value)}
                />
              </div>
              <Button
                variant="destructive"
                disabled={isPending || confirm !== tenant.name}
                onClick={() =>
                  run(() => deleteTenantPermanently(tenant._id, confirm))
                }
              >
                Delete {tenant.name} and all its data
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
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
