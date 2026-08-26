"use client";

import { useState } from "react";
import {
  BadgeCheck,
  Copy,
  Globe,
  Loader2,
  Plus,
  ShieldAlert,
  ShieldCheck,
  Star,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  addTenantDomain,
  checkTenantDomainTls,
  removeTenantDomain,
  setPrimaryTenantDomain,
  updateTenantSlug,
  verifyTenantDomain,
} from "@/server/tenantServer/tenantSettingsServer";

const DomainsPanel = ({ tenant, platformRootDomain, run, isPending }) => {
  const [newHost, setNewHost] = useState("");
  const [slug, setSlug] = useState(tenant.slug || "");

  const copy = (text) => {
    navigator.clipboard.writeText(text);
    toast.success("Copied");
  };

  return (
    <div className="space-y-4">
      {/* ---------------------------------------------------- workspace URL */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Workspace address</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            A short name that always reaches your company, even while a custom
            domain&apos;s DNS is still propagating.
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="slug">Address</Label>
              <div className="flex items-center gap-1">
                <Input
                  id="slug"
                  value={slug}
                  placeholder="acme"
                  className="w-48"
                  onChange={(e) => setSlug(e.target.value)}
                />
                <span className="text-sm text-muted-foreground">
                  .{platformRootDomain || "your-platform-domain.com"}
                </span>
              </div>
            </div>
            <Button
              variant="outline"
              disabled={isPending || !slug || slug === tenant.slug}
              onClick={() => run(() => updateTenantSlug(tenant._id, slug))}
            >
              {isPending && <Loader2 className="size-4 animate-spin" />}
              Save address
            </Button>
          </div>
          {!platformRootDomain && (
            <p className="text-xs text-amber-600 dark:text-amber-500">
              PLATFORM_ROOT_DOMAIN is not configured on the server, so this
              address will not resolve yet. The custom domains below still work.
            </p>
          )}
        </CardContent>
      </Card>

      {/* -------------------------------------------------------- add domain */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Custom domains for {tenant.name}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="newHost">Add a domain</Label>
              <Input
                id="newHost"
                value={newHost}
                placeholder="hr.acme.com"
                className="w-72"
                onChange={(e) => setNewHost(e.target.value)}
              />
            </div>
            <Button
              disabled={isPending || !newHost.trim()}
              onClick={() =>
                run(() => addTenantDomain(tenant._id, newHost), {
                  onSuccess: () => setNewHost(""),
                })
              }
            >
              {isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Plus className="size-4" />
              )}
              Add
            </Button>
          </div>

          {tenant.domains.length === 0 ? (
            <div className="rounded-lg border border-dashed p-8 text-center">
              <Globe className="mx-auto size-6 text-muted-foreground" />
              <p className="mt-2 text-sm font-medium">No domains yet</p>
              <p className="text-xs text-muted-foreground">
                Add one above, then publish a DNS record to verify it.
              </p>
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
                        <>
                          <Badge className="gap-1">
                            <BadgeCheck className="size-3" />
                            Verified
                          </Badge>
                          {d.sslStatus === "issued" ? (
                            <Badge variant="outline" className="gap-1">
                              <ShieldCheck className="size-3" />
                              HTTPS live
                            </Badge>
                          ) : (
                            <Badge variant="secondary">HTTPS pending</Badge>
                          )}
                        </>
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
                          onClick={() => run(() => verifyTenantDomain(tenant._id, d.host))}
                        >
                          {isPending && (
                            <Loader2 className="size-4 animate-spin" />
                          )}
                          Verify
                        </Button>
                      )}
                      {d.verified && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={isPending}
                          onClick={() =>
                            run(() => checkTenantDomainTls(tenant._id, d.host))
                          }
                        >
                          <ShieldCheck className="size-4" />
                          Check HTTPS
                        </Button>
                      )}
                      {d.verified && !d.isPrimary && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={isPending}
                          onClick={() =>
                            run(() => setPrimaryTenantDomain(tenant._id, d.host))
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
                        onClick={() => run(() => removeTenantDomain(tenant._id, d.host))}
                      >
                        <Trash2 className="size-4 text-rose-600" />
                      </Button>
                    </div>
                  </div>

                  {!d.verified && (
                    <div className="rounded-md bg-muted/50 p-3 text-xs">
                      <p className="mb-2 font-medium">
                        Add this TXT record at your DNS provider, then press
                        Verify:
                      </p>
                      <div className="grid gap-2 sm:grid-cols-[auto_1fr]">
                        <span className="text-muted-foreground">Name</span>
                        <CopyRow
                          value={`_verify.${d.host}`}
                          onCopy={copy}
                        />
                        <span className="text-muted-foreground">Value</span>
                        <CopyRow value={d.verificationToken} onCopy={copy} />
                      </div>
                      <p className="mt-2 text-muted-foreground">
                        Then point <code>{d.host}</code> at this application
                        with a CNAME or A record. Once both records are live,
                        press Verify — the HTTPS certificate is issued
                        automatically on the first visit afterwards.
                      </p>
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

export default DomainsPanel;
