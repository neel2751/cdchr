"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Loader2, Star } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatMoney } from "@/lib/money";
import {
  addCompanyToAccount,
  getAccount,
  removeCompanyFromAccount,
  setAccountLock,
  setPrimaryCompany,
  updateAccount,
} from "@/server/billingServer/accountServer";

/**
 * One customer: its companies on one bill, each priced live from today's
 * usage, and the total. The main company pays the full package price.
 */
export default function AccountDetail({ accountId }) {
  const { data, error, isLoading, refetch } = useQuery({
    queryKey: ["billingAccount", accountId],
    queryFn: async () => {
      const res = await getAccount(accountId);
      if (!res?.success) throw new Error(res?.message || "Could not load");
      return JSON.parse(res.data);
    },
  });
  const [isPending, startTransition] = useTransition();
  const run = (action) =>
    startTransition(async () => {
      const res = await action();
      if (res?.success) {
        toast.success(res.message || "Saved");
        await refetch();
      } else {
        toast.error(res?.message || "Something went wrong");
      }
    });

  if (isLoading) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Pricing each company…
      </p>
    );
  }
  if (error) return <p className="text-sm text-destructive">{error.message}</p>;

  const money = (p) => formatMoney(p, data.currency);
  const { account, companies, total } = data;

  return (
    <div className="space-y-5">
      <Link
        href="/platform/accounts"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> All accounts
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{account.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {companies.length} compan{companies.length === 1 ? "y" : "ies"} on one bill ·
            extra companies {data.extraCompanyDiscountPercent}% off the package price
          </p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-semibold tabular-nums">{money(total.monthlyNetPence)}</p>
          <p className="text-xs text-muted-foreground">
            a month before VAT, at today&apos;s numbers
          </p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-3">
          {companies.map((c) => (
            <Card key={c._id}>
              <CardHeader className="flex-row flex-wrap items-start justify-between gap-2 space-y-0">
                <div className="space-y-1">
                  <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                    <Link href={`/platform/tenants/${c._id}`} className="hover:underline">
                      {c.name}
                    </Link>
                    {c.primary ? (
                      <Badge>Main company</Badge>
                    ) : (
                      <Badge variant="secondary">Extra company</Badge>
                    )}
                    {c.access !== "full" && c.access !== "grace" && (
                      <Badge variant="destructive">{c.access}</Badge>
                    )}
                  </CardTitle>
                  <p className="text-xs text-muted-foreground">
                    {c.plan ? `Package: ${c.quote.companies[0]?.planName || c.plan}` : "No package yet"}
                    {" · "}
                    {c.usage.officeStaff} office staff · {c.usage.workers} students / workers
                    {c.status === "trial" ? " · on trial" : ""}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-semibold tabular-nums">
                    {c.plan ? money(c.quote.monthlyNetPence) : "—"}
                  </p>
                  <p className="text-xs text-muted-foreground">a month</p>
                </div>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {!c.primary && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isPending}
                    onClick={() => run(() => setPrimaryCompany(account._id, c._id))}
                  >
                    <Star className="size-4" /> Make main company
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={isPending}
                  onClick={() => run(() => removeCompanyFromAccount(c._id))}
                >
                  Take out of this account
                </Button>
              </CardContent>
            </Card>
          ))}

          <AddCompany
            available={data.available}
            disabled={isPending}
            onAdd={(id) => run(() => addCompanyToAccount(account._id, id))}
          />
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">The bill</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              {companies.map((c) => (
                <div key={c._id} className="flex justify-between gap-2">
                  <span className="truncate">{c.name}</span>
                  <span className="tabular-nums">{c.plan ? money(c.quote.monthlyNetPence) : "—"}</span>
                </div>
              ))}
              <div className="flex justify-between gap-2 border-t pt-1 font-semibold">
                <span>A month, before VAT</span>
                <span className="tabular-nums">{money(total.monthlyNetPence)}</span>
              </div>
              <p className="pt-1 text-xs text-muted-foreground">
                Companies billed yearly are shown a month here. Each company&apos;s
                Price tab sets its package.
              </p>
            </CardContent>
          </Card>

          <AccountDetails account={account} disabled={isPending} run={run} />
          <LockAll account={account} disabled={isPending} run={run} />
        </div>
      </div>
    </div>
  );
}

function AddCompany({ available, disabled, onAdd }) {
  const [id, setId] = useState("");
  if (!available.length) return null;
  return (
    <Card>
      <CardContent className="flex flex-wrap items-end gap-2 pt-6">
        <div className="min-w-56 flex-1 space-y-1.5">
          <Label className="text-xs">Add a company or branch</Label>
          <Select value={id} onValueChange={setId}>
            <SelectTrigger className="h-9">
              <SelectValue placeholder="Choose a company billed on its own" />
            </SelectTrigger>
            <SelectContent>
              {available.map((c) => (
                <SelectItem key={c._id} value={c._id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          disabled={disabled || !id}
          onClick={() => {
            onAdd(id);
            setId("");
          }}
        >
          Add
        </Button>
      </CardContent>
    </Card>
  );
}

function AccountDetails({ account, disabled, run }) {
  const [name, setName] = useState(account.name);
  const [billingEmail, setBillingEmail] = useState(account.billingEmail || "");
  const [notes, setNotes] = useState(account.notes || "");
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Account</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="acc-name" className="text-xs">
            Customer name
          </Label>
          <Input id="acc-name" value={name} onChange={(e) => setName(e.target.value)} className="h-9" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="acc-email" className="text-xs">
            Billing email
          </Label>
          <Input
            id="acc-email"
            type="email"
            value={billingEmail}
            onChange={(e) => setBillingEmail(e.target.value)}
            className="h-9"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="acc-notes" className="text-xs">
            Notes
          </Label>
          <Textarea id="acc-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        <Button
          size="sm"
          disabled={disabled}
          onClick={() => run(() => updateAccount(account._id, { name, billingEmail, notes }))}
        >
          Save
        </Button>
      </CardContent>
    </Card>
  );
}

function LockAll({ account, disabled, run }) {
  const [level, setLevel] = useState("none");
  const [message, setMessage] = useState("");
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Lock every company</CardTitle>
        <p className="text-sm text-muted-foreground">
          An unpaid bill is the customer&apos;s, not one branch&apos;s. Nothing is
          deleted.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <RadioGroup value={level} onValueChange={setLevel} className="gap-2">
          {[
            ["none", "Unlock all"],
            ["readOnly", "Read-only (clocking in still works)"],
            ["locked", "Locked (only super admins can sign in)"],
          ].map(([value, label]) => (
            <Label key={value} htmlFor={`all-${value}`} className="flex items-center gap-2 font-normal">
              <RadioGroupItem id={`all-${value}`} value={value} />
              {label}
            </Label>
          ))}
        </RadioGroup>
        {level !== "none" && (
          <Textarea
            rows={2}
            maxLength={500}
            placeholder="Note shown to the companies, e.g. Invoice INV-0042 is overdue."
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
        )}
        <Button
          size="sm"
          variant={level === "none" ? "default" : "destructive"}
          disabled={disabled}
          onClick={() =>
            run(() =>
              setAccountLock(account._id, {
                level: level === "none" ? null : level,
                message,
              })
            )
          }
        >
          {level === "none" ? "Unlock all" : level === "locked" ? "Lock all" : "Make all read-only"}
        </Button>
      </CardContent>
    </Card>
  );
}
