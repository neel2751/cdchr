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
  getCarrierAccounts,
  saveCarrierAccount,
  testCarrierAccount,
} from "@/server/tagServer/carrierLabels";

/**
 * Postage accounts.
 *
 * Credentials go in and never come back out — the screen shows the last four
 * characters so an operator can tell which key is stored, and nothing more.
 *
 * Switched off by default, and the copy says why: an adapter here has never
 * been run against a live account, so the first purchase through one is a
 * test whether anybody planned it that way or not.
 */
export default function CarrierAccounts() {
  const queryClient = useQueryClient();
  const { data } = useFetchSelectQuery({
    queryKey: ["carrierAccounts"],
    fetchFn: getCarrierAccounts,
  });

  const providers = data?.providers || [];
  const sealingReady = data?.sealingReady;

  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState({});

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["carrierAccounts"] });

  const run = (promise) =>
    promise.then((res) => {
      if (!res?.success) {
        toast.error(res?.message || "That did not work");
        return;
      }
      toast.success(res.message);
      setDraft({});
      refresh();
    });

  const { mutate: save, isPending: saving } = useMutation({
    mutationFn: (args) => run(saveCarrierAccount(args)),
  });
  const { mutate: test, isPending: testing } = useMutation({
    mutationFn: (args) =>
      testCarrierAccount(args).then((res) => {
        // A failed test is information, not an error to swallow — it is the
        // whole reason the button exists.
        if (res?.success) toast.success(res.message);
        else toast.error(res?.message || "The test failed");
        refresh();
      }),
  });

  const busy = saving || testing;
  const apiProviders = providers.filter((p) => p.mode === "api");

  return (
    <Card>
      <CardHeader className="cursor-pointer" onClick={() => setOpen((o) => !o)}>
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base">Postage accounts</CardTitle>
            <CardDescription>
              {apiProviders.some((p) => p.isEnabled)
                ? `Buying postage through ${apiProviders
                    .filter((p) => p.isEnabled)
                    .map((p) => p.name)
                    .join(", ")}.`
                : "None enabled — postage is bought on the carrier's own site and the tracking number typed in."}
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
            <p className="font-medium">These adapters have never been run.</p>
            <p className="mt-1">
              They are written to each carrier&apos;s published specification,
              which is not the same as having watched one work — nobody here
              has an account. Save the key, press <strong>Test</strong>, and
              only then enable it. If a purchase fails, the shipment is
              unaffected: buy on the carrier&apos;s site and type the number
              in, exactly as before.
            </p>
          </div>

          {!sealingReady ? (
            <p className="rounded-md border border-red-300 bg-red-50 p-3 text-xs text-red-900">
              TAG_KEY_MASTER is not set, so credentials cannot be sealed.
              Generate one with <code>openssl rand -hex 32</code> first.
            </p>
          ) : null}

          {apiProviders.map((p) => (
            <div key={p.key} className="space-y-2 rounded-md border p-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">{p.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {p.configured ? "Key stored" : "No key stored"}
                    {p.hasTestHost && p.environment === "test"
                      ? " · pointed at the TEST host, so nothing it buys is real postage"
                      : ""}
                    {p.lastTestedAt
                      ? ` · last test ${p.lastTestOk ? "passed" : "failed"}: ${p.lastTestMessage}`
                      : " · never tested"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {p.hasTestHost ? (
                    <select
                      className="h-8 rounded-md border px-2 text-xs"
                      value={p.environment}
                      disabled={busy}
                      onChange={(e) =>
                        save({ provider: p.key, environment: e.target.value })
                      }
                    >
                      <option value="test">Test host</option>
                      <option value="production">Production</option>
                    </select>
                  ) : null}
                  <Label className="text-xs" htmlFor={`en-${p.key}`}>
                    Enabled
                  </Label>
                  <Switch
                    id={`en-${p.key}`}
                    checked={p.isEnabled}
                    disabled={busy || !p.configured}
                    onCheckedChange={(v) =>
                      save({ provider: p.key, isEnabled: v })
                    }
                  />
                </div>
              </div>

              {p.provisional ? (
                <p className="rounded border border-orange-300 bg-orange-50 p-2 text-[11px] text-orange-900">
                  <strong>Provisional adapter.</strong> {p.provisionalNote}
                </p>
              ) : null}

              {p.needs.map((field) => (
                <div key={field.name} className="space-y-1">
                  <Label htmlFor={`${p.key}-${field.name}`} className="text-xs">
                    {field.label}
                    {p.hints?.[field.name] ? (
                      <span className="ml-2 font-mono text-muted-foreground">
                        {p.hints[field.name]}
                      </span>
                    ) : null}
                  </Label>
                  <Input
                    id={`${p.key}-${field.name}`}
                    // A header name or a base URL is not a secret, and masking
                    // it makes it impossible to check for a typo — which is
                    // exactly what these fields exist to let somebody fix.
                    // A header name, a base URL, a path or a box size is not a
                    // secret, and masking it makes a typo impossible to spot
                    // — which defeats the point of making it editable.
                    type={
                      /header|Base$|Path$|SizeCm$/i.test(field.name)
                        ? "text"
                        : "password"
                    }
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
                  onClick={() => test({ provider: p.key })}
                >
                  {testing ? (
                    <Loader2 className="mr-1 size-3.5 animate-spin" />
                  ) : (
                    <Plug className="mr-1 size-3.5" />
                  )}
                  Test
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      ) : null}
    </Card>
  );
}
