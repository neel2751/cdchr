"use client";

import React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Loader2, Plug, Save } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useFetchSelectQuery } from "@/hooks/use-query";
import {
  getAddressAccounts,
  saveAddressAccount,
  testAddressAccount,
} from "@/server/addressServer/paf";

/**
 * Our PAF licence.
 *
 * The screen has to be honest about two things a postage account does not
 * have to be: that every lookup is billed to us, and that the people spending
 * it are customers. Hence the daily ceiling sitting next to the switch rather
 * than buried, and hence the test button saying what it costs.
 */
export default function AddressAccounts() {
  const queryClient = useQueryClient();
  const { data } = useFetchSelectQuery({
    queryKey: ["addressAccounts"],
    fetchFn: getAddressAccounts,
  });

  const providers = data?.providers || [];
  const sealingReady = data?.sealingReady;
  const live = providers.find((p) => p.isEnabled);

  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState({});

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["addressAccounts"] });
    // The order form asks whether the button should exist at all.
    queryClient.invalidateQueries({ queryKey: ["addressLookupAvailable"] });
  };

  const { mutate: save, isPending: saving } = useMutation({
    mutationFn: (args) =>
      saveAddressAccount(args).then((res) => {
        if (!res?.success) {
          toast.error(res?.message || "That did not work");
          return;
        }
        toast.success(res.message);
        setDraft({});
        refresh();
      }),
  });

  const { mutate: test, isPending: testing } = useMutation({
    mutationFn: (args) =>
      testAddressAccount(args).then((res) => {
        if (res?.success) toast.success(res.message);
        else toast.error(res?.message || "The test failed");
        refresh();
      }),
  });

  const busy = saving || testing;

  return (
    <Card>
      <CardHeader className="cursor-pointer" onClick={() => setOpen((o) => !o)}>
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base">Address lookup (PAF)</CardTitle>
            <CardDescription>
              {live
                ? `Customers can find their address by postcode, through ${live.name}.`
                : "Off — customers type their delivery address by hand."}
            </CardDescription>
          </div>
          <ChevronDown
            className={`size-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
          />
        </div>
      </CardHeader>

      {open ? (
        <CardContent className="space-y-4">
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
            <p className="font-medium">Every lookup is billed to us.</p>
            <p className="mt-1">
              PAF is Royal Mail&apos;s licensed address file, and these are
              resellers of it — the key is ours and so is the invoice, while
              the people pressing the button are customers. The daily ceiling
              below is per company. Switching this off costs nothing and loses
              nothing: the order form goes back to a typed address, which is
              how it works today.
            </p>
            <p className="mt-1">
              Only the address a customer actually picks is stored, on their
              own order. Lookups themselves are held for minutes, in memory —
              PAF licences restrict keeping address data, so check yours.
            </p>
          </div>

          {!sealingReady ? (
            <p className="rounded-md border border-red-300 bg-red-50 p-3 text-xs text-red-900">
              TAG_KEY_MASTER is not set, so keys cannot be sealed.
            </p>
          ) : null}

          {providers.map((p) => (
            <div key={p.key} className="space-y-2 rounded-md border p-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">{p.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {p.configured ? "Key stored" : "No key stored"}
                    {p.lastTestedAt
                      ? ` · last test ${p.lastTestOk ? "passed" : "failed"}: ${p.lastTestMessage}`
                      : " · never tested"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Label className="text-xs" htmlFor={`addr-en-${p.key}`}>
                    Enabled
                  </Label>
                  <Switch
                    id={`addr-en-${p.key}`}
                    checked={p.isEnabled}
                    disabled={busy || !p.configured}
                    onCheckedChange={(v) =>
                      save({ provider: p.key, isEnabled: v })
                    }
                  />
                </div>
              </div>

              {p.needs.map((field) => (
                <div key={field.name} className="space-y-1">
                  <Label htmlFor={`addr-${p.key}-${field.name}`} className="text-xs">
                    {field.label}
                    {p.hints?.[field.name] ? (
                      <span className="ml-2 font-mono text-muted-foreground">
                        {p.hints[field.name]}
                      </span>
                    ) : null}
                  </Label>
                  <Input
                    id={`addr-${p.key}-${field.name}`}
                    type="password"
                    autoComplete="off"
                    placeholder={
                      p.configured ? "Leave blank to keep the stored key" : ""
                    }
                    value={draft[`${p.key}.${field.name}`] || ""}
                    disabled={busy || !sealingReady}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        [`${p.key}.${field.name}`]: e.target.value,
                      }))
                    }
                  />
                  {field.help ? (
                    <p className="text-[11px] text-muted-foreground">
                      {field.help}
                    </p>
                  ) : null}
                </div>
              ))}

              <div className="space-y-1">
                <Label htmlFor={`addr-limit-${p.key}`} className="text-xs">
                  Daily lookups per company
                </Label>
                <Input
                  id={`addr-limit-${p.key}`}
                  type="number"
                  min={0}
                  className="w-32"
                  defaultValue={p.dailyLookupLimit}
                  disabled={busy}
                  onBlur={(e) =>
                    save({
                      provider: p.key,
                      dailyLookupLimit: Number(e.target.value),
                    })
                  }
                />
                <p className="text-[11px] text-muted-foreground">
                  0 means no ceiling. One customer holding down a button should
                  not be able to run up the bill.
                </p>
              </div>

              <div className="flex gap-2">
                <Button
                  size="sm"
                  disabled={busy || !sealingReady}
                  onClick={() =>
                    save({
                      provider: p.key,
                      credentials: Object.fromEntries(
                        p.needs.map((f) => [
                          f.name,
                          draft[`${p.key}.${f.name}`] || "",
                        ]),
                      ),
                    })
                  }
                >
                  {saving ? (
                    <Loader2 className="mr-1 size-3.5 animate-spin" />
                  ) : (
                    <Save className="mr-1 size-3.5" />
                  )}
                  Save key
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || !p.configured}
                  title="Costs one billable lookup — these services publish no free ping"
                  onClick={() => test({ provider: p.key })}
                >
                  {testing ? (
                    <Loader2 className="mr-1 size-3.5 animate-spin" />
                  ) : (
                    <Plug className="mr-1 size-3.5" />
                  )}
                  Test (1 lookup)
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      ) : null}
    </Card>
  );
}
