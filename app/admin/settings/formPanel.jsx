"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { FIELD_BLOCKS, resolveFieldBlocks } from "@/data/fieldBlocks";
import { fillTerms } from "@/data/terminology";
import {
  updateTenantFieldBlocks,
  updateTenantManagerRules,
} from "@/server/tenantServer/tenantSettingsServer";

/**
 * Which parts of the site employee form the company uses — pay, CIS, right to
 * work, parent or guardian, medical, school. See data/fieldBlocks.js.
 *
 * The starting set comes from the industry chosen on the Words tab. A block
 * that is off is not asked for, not required, and not shown in lists.
 */
const FormPanel = ({ tenant, run, isPending }) => {
  const [on, setOn] = useState(() => ({ ...tenant.fieldBlocks }));
  // Prerequisites applied as the switches move, so the screen shows what will
  // actually be saved: no CIS without pay.
  const effective = resolveFieldBlocks([], on);
  const who = fillTerms("{siteEmployees}", tenant.terms);

  const onSubmit = (e) => {
    e.preventDefault();
    run(() => updateTenantFieldBlocks(tenant._id, { fieldBlocks: effective }));
  };

  return (
    <div className="space-y-4">
      <form onSubmit={onSubmit}>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {fillTerms("{SiteEmployee} form", tenant.terms)}
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              What you record about your {who}. Name, contact details, address,
              join date and emergency contact are always asked. Switch on the
              parts you need; anything switched off is not asked for and does
              not appear in lists.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {FIELD_BLOCKS.map((block) => {
              const blockedBy = block.requires.filter((req) => !effective[req]);
              return (
                <div
                  key={block.key}
                  className="flex items-start justify-between gap-4 rounded-lg border p-3"
                >
                  <div className="space-y-0.5">
                    <Label htmlFor={`block-${block.key}`}>{block.label}</Label>
                    <p className="text-xs text-muted-foreground">
                      {block.help}
                    </p>
                    {blockedBy.length > 0 && (
                      <p className="text-xs text-amber-700">
                        Needs{" "}
                        {blockedBy
                          .map(
                            (req) =>
                              FIELD_BLOCKS.find((b) => b.key === req)?.label,
                          )
                          .join(", ")}{" "}
                        switched on.
                      </p>
                    )}
                  </div>
                  <Switch
                    id={`block-${block.key}`}
                    checked={!!effective[block.key]}
                    disabled={blockedBy.length > 0}
                    onCheckedChange={(checked) =>
                      setOn((prev) => ({ ...prev, [block.key]: checked }))
                    }
                  />
                </div>
              );
            })}

            <div className="flex items-center gap-3 pt-1">
              <Button type="submit" disabled={isPending}>
                {isPending && <Loader2 className="size-4 animate-spin" />}
                Save form
              </Button>
              <p className="text-xs text-muted-foreground">
                Records already saved keep their details; switching a part off
                only stops it being asked for and shown.
              </p>
            </div>
          </CardContent>
        </Card>
      </form>
      <ManagerRules tenant={tenant} run={run} isPending={isPending} />
    </div>
  );
};

/**
 * What a place manager — a site manager, a class teacher — may do on the
 * places they run. See resolveManagerRules in data/terminology.js.
 */
const MANAGER_RULES = [
  {
    key: "canAssign",
    label: "{SiteManagers} can assign people",
    help: "Put people on, move them between and end them on the {sites} they manage. Off: only administrators assign; managers still see and record attendance.",
  },
  {
    key: "seeContacts",
    label: "{SiteManagers} can see contact details",
    help: "Phone numbers, emails and parent or guardian contacts on the {MySites} page. Off: they see names, today's attendance and medical notes only.",
  },
];

const ManagerRules = ({ tenant, run, isPending }) => {
  const [rules, setRules] = useState(() => ({ ...tenant.managerRules }));
  const fill = (text) => fillTerms(text, tenant.terms);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        run(() =>
          updateTenantManagerRules(tenant._id, { managerRules: rules }),
        );
      }}
    >
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{fill("{SiteManagers}")}</CardTitle>
          <p className="text-sm text-muted-foreground">
            {fill("What the people running a {site} may do there.")}
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {MANAGER_RULES.map((rule) => (
            <div
              key={rule.key}
              className="flex items-start justify-between gap-4 rounded-lg border p-3"
            >
              <div className="space-y-0.5">
                <Label htmlFor={`rule-${rule.key}`}>{fill(rule.label)}</Label>
                <p className="text-xs text-muted-foreground">
                  {fill(rule.help)}
                </p>
              </div>
              <Switch
                id={`rule-${rule.key}`}
                checked={!!rules[rule.key]}
                onCheckedChange={(checked) =>
                  setRules((prev) => ({ ...prev, [rule.key]: checked }))
                }
              />
            </div>
          ))}
          <Button type="submit" disabled={isPending}>
            {isPending && <Loader2 className="size-4 animate-spin" />}
            Save
          </Button>
        </CardContent>
      </Card>
    </form>
  );
};

export default FormPanel;
