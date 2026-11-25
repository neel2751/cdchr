"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Building2, Loader2, Plus, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatMoney } from "@/lib/money";
import { createAccount, listAccounts } from "@/server/billingServer/accountServer";
import { getTenants } from "@/server/tenantServer/tenantServer";

/**
 * Billing accounts: each customer, its companies, and the monthly total as
 * recorded. Suggests grouping companies that share an owner's login.
 */
export default function AccountsList() {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const { data, error, isLoading, refetch } = useQuery({
    queryKey: ["billingAccounts"],
    queryFn: async () => {
      const res = await listAccounts();
      if (!res?.success) throw new Error(res?.message || "Could not load");
      return JSON.parse(res.data);
    },
  });
  const [isPending, startTransition] = useTransition();

  const group = (name, companyIds) =>
    startTransition(async () => {
      const res = await createAccount({ name, companyIds });
      if (!res?.success) return toast.error(res?.message || "Could not create");
      toast.success(res.message);
      router.push(`/platform/accounts/${res.id}`);
    });

  if (isLoading) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Loading accounts…
      </p>
    );
  }
  if (error) return <p className="text-sm text-destructive">{error.message}</p>;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Billing accounts</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            A customer&apos;s companies and branches on one bill. The main company
            pays the full package price; the rest get the extra-company price.
          </p>
        </div>
        {!creating && (
          <Button onClick={() => setCreating(true)}>
            <Plus className="size-4" /> New account
          </Button>
        )}
      </div>

      {creating && (
        <NewAccount
          onCancel={() => setCreating(false)}
          onCreated={(id) => router.push(`/platform/accounts/${id}`)}
        />
      )}

      {data.suggestions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="size-4" /> Probably one customer
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              These companies share a super admin login but are billed apart.
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.suggestions.map((s) => (
              <div
                key={s.owner}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {s.companies.map((c) => c.name).join(" · ")}
                  </p>
                  <p className="text-xs text-muted-foreground">Owner: {s.owner}</p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={isPending}
                  onClick={() =>
                    group(
                      s.companies[0].name,
                      s.companies.map((c) => c._id)
                    )
                  }
                >
                  Make one account
                </Button>
              </div>
            ))}
            <p className="text-xs text-muted-foreground">
              The first company listed becomes the main one; you can change
              that on the account.
            </p>
          </CardContent>
        </Card>
      )}

      {data.accounts.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No accounts yet. A company not in an account is billed on its own.
        </p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {data.accounts.map((a) => (
            <Link key={a._id} href={`/platform/accounts/${a._id}`} className="block">
              <Card className="h-full transition-colors hover:bg-muted/40">
                <CardHeader className="space-y-1">
                  <CardTitle className="flex items-center justify-between gap-2 text-base">
                    {a.name}
                    <span className="text-sm font-normal tabular-nums text-muted-foreground">
                      {formatMoney(a.monthlyPence)} / month
                    </span>
                  </CardTitle>
                  {a.billingEmail && (
                    <p className="text-xs text-muted-foreground">{a.billingEmail}</p>
                  )}
                </CardHeader>
                <CardContent className="flex flex-wrap gap-1.5">
                  {a.companies.map((c) => (
                    <Badge key={c._id} variant={c.primary ? "default" : "secondary"}>
                      <Building2 className="mr-1 size-3" />
                      {c.name}
                      {c.access !== "full" && c.access !== "grace" ? ` · ${c.access}` : ""}
                    </Badge>
                  ))}
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
      <Button variant="ghost" size="sm" onClick={() => refetch()}>
        Refresh
      </Button>
    </div>
  );
}

function NewAccount({ onCancel, onCreated }) {
  const [name, setName] = useState("");
  const [billingEmail, setBillingEmail] = useState("");
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState([]);
  const [isPending, startTransition] = useTransition();

  const { data: companies = [] } = useQuery({
    queryKey: ["accountCompanySearch", query],
    queryFn: async () => {
      const res = await getTenants({ query, page: 1, pageSize: 20 });
      return res?.success ? JSON.parse(res.data) : [];
    },
  });

  const toggle = (c, on) =>
    setChosen((list) =>
      on ? [...list, { _id: c._id, name: c.name }] : list.filter((x) => x._id !== c._id)
    );

  const submit = () =>
    startTransition(async () => {
      const res = await createAccount({
        name,
        billingEmail,
        companyIds: chosen.map((c) => c._id),
      });
      if (!res?.success) return toast.error(res?.message || "Could not create");
      toast.success(res.message);
      onCreated(res.id);
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">New billing account</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="acc-name">Customer name</Label>
            <Input
              id="acc-name"
              value={name}
              placeholder="e.g. Creative Design & Construction"
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="acc-email">Billing email (optional)</Label>
            <Input
              id="acc-email"
              type="email"
              value={billingEmail}
              placeholder="accounts@customer.co.uk"
              onChange={(e) => setBillingEmail(e.target.value)}
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="acc-search">Companies</Label>
          <Input
            id="acc-search"
            value={query}
            placeholder="Search companies"
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="max-h-56 space-y-1 overflow-y-auto rounded-md border p-2">
            {companies.map((c) => (
              <label key={c._id} className="flex cursor-pointer items-center gap-2 text-sm">
                <Checkbox
                  checked={chosen.some((x) => x._id === c._id)}
                  onCheckedChange={(on) => toggle(c, on === true)}
                />
                {c.name}
                <span className="text-xs text-muted-foreground">{c.slug}</span>
              </label>
            ))}
            {companies.length === 0 && (
              <p className="text-xs text-muted-foreground">No companies found.</p>
            )}
          </div>
          {chosen.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Main company: <strong>{chosen[0].name}</strong>
              {chosen.length > 1 ? ` · extra: ${chosen.slice(1).map((c) => c.name).join(", ")}` : ""}
            </p>
          )}
        </div>

        <div className="flex gap-2">
          <Button disabled={isPending || !name.trim() || !chosen.length} onClick={submit}>
            {isPending && <Loader2 className="size-4 animate-spin" />}
            Create account
          </Button>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
