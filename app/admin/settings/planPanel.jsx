"use client";

import { Check, Lock } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FEATURES, FEATURE_GROUPS } from "@/data/features";
import { isFeatureEnabled } from "@/lib/tenantPlan";

/**
 * What this company's plan includes — and, deliberately, what it does not.
 *
 * This is the one place a customer sees a module they do not have. Everywhere
 * operational keeps them completely hidden: the sidebar drops them
 * (selectServer.getEmployeeMenu), the routes redirect (proxy.js), the actions
 * refuse (lib/requireFeature.js) and the dashboard omits their cards. A
 * half-present module in day-to-day use is clutter that leads somewhere locked.
 *
 * An informational page is the opposite case. "Can we do expenses?" currently
 * has no answer inside the product, so it becomes a support ticket — or worse,
 * the assumption that the product cannot do it at all. Listing every module with
 * its status answers the question and says how to change it.
 *
 * Strictly read-only. What a company may use is a commercial decision, so the
 * switches live in the platform console and nothing here can write.
 */
const PlanPanel = ({ tenant, supportEmail }) => {
  const features = tenant.features || {};
  const included = FEATURES.filter((f) => isFeatureEnabled(features, f.key));
  const excluded = FEATURES.length - included.length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          Your plan
          {tenant.plan && (
            <Badge variant="secondary" className="ml-2 font-normal capitalize">
              {tenant.plan}
            </Badge>
          )}
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          {excluded === 0
            ? `All ${FEATURES.length} modules are included.`
            : `${included.length} of ${FEATURES.length} modules are included. ` +
              `The rest are not part of your plan and are hidden across the app.`}
        </p>
      </CardHeader>

      <CardContent className="space-y-5">
        {FEATURE_GROUPS.map((group) => {
          const inGroup = FEATURES.filter((f) => f.group === group);
          if (!inGroup.length) return null;

          return (
            <div key={group} className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {group}
              </p>
              <ul className="grid gap-2 sm:grid-cols-2">
                {inGroup.map(({ key, label, description }) => {
                  const on = isFeatureEnabled(features, key);
                  return (
                    <li
                      key={key}
                      className={`rounded-md border p-2.5 text-sm ${
                        on ? "" : "bg-muted/40"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p
                            className={`flex items-center gap-1.5 font-medium ${
                              on ? "" : "text-muted-foreground"
                            }`}
                          >
                            {on ? (
                              <Check
                                className="size-3.5 shrink-0 text-primary"
                                aria-hidden="true"
                              />
                            ) : (
                              <Lock
                                className="size-3.5 shrink-0 text-muted-foreground"
                                aria-hidden="true"
                              />
                            )}
                            {label}
                          </p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {description}
                          </p>
                        </div>
                      </div>

                      {!on && (
                        <p className="mt-2 text-xs text-muted-foreground">
                          <Badge
                            variant="outline"
                            className="mr-1.5 font-normal"
                          >
                            Not included in your plan
                          </Badge>
                          {supportEmail ? (
                            <>
                              <a
                                className="underline underline-offset-2 hover:text-foreground"
                                href={`mailto:${supportEmail}?subject=${encodeURIComponent(
                                  `Enable ${label} for ${tenant.name}`
                                )}`}
                              >
                                Contact support
                              </a>{" "}
                              to enable
                            </>
                          ) : (
                            "Contact support to enable"
                          )}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}

        <p className="text-xs text-muted-foreground">
          Attendance, office staff, departments, permissions, audit logs, company
          settings and email are part of every plan.
        </p>
      </CardContent>
    </Card>
  );
};

export default PlanPanel;
