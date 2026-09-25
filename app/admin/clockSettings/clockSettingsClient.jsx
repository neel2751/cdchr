"use client";

import React from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import ClockAnomalies from "./components/clockAnomalies";
import ClockEvidenceReport from "./components/clockEvidenceReport";
import ClockLocationRules from "./components/clockLocationRules";
import ClockLocationsSettings from "./components/clockLocationsSettings";
import ClockRulesSettings from "./components/clockRulesSettings";
import ClockTagsSettings from "./components/clockTagsSettings";
import InvoicesSettings from "./components/invoicesSettings";
import TagOrderSettings from "./components/tagOrderSettings";
import WorkHoursSettings from "./components/workHoursSettings";

/**
 * Everything about clocking in, in one place.
 *
 * These cards used to live under Leave Management → Settings, which is where
 * they ended up one at a time rather than where anybody would look for them:
 * changing a clock-in rule meant opening the leave screens, and Leave
 * Management's own settings were buried among nine cards that had nothing to
 * do with leave.
 *
 * Grouped into tabs rather than one long page because the list is now long
 * enough that scrolling past eight cards to reach the ninth is its own
 * problem. The order is the order somebody sets a company up in: what the
 * scanner allows, where people scan, what they scan with, and then how it went.
 */
const TABS = [
  {
    value: "rules",
    label: "Rules",
    blurb: "What the scanner accepts, and the contracted week it measures against.",
    render: () => (
      <>
        <ClockRulesSettings />
        <WorkHoursSettings />
      </>
    ),
  },
  {
    value: "locations",
    label: "Locations",
    blurb: "The places people clock in at, and how each one proves somebody is there.",
    render: () => (
      <>
        <ClockLocationsSettings />
        <ClockLocationRules />
      </>
    ),
  },
  {
    value: "tags",
    label: "Tags & hardware",
    blurb: "NFC tags in use, ordering more, and what they cost.",
    render: () => (
      <>
        <ClockTagsSettings />
        <TagOrderSettings />
        <InvoicesSettings />
      </>
    ),
  },
  {
    value: "reports",
    label: "Reports",
    blurb: "What the evidence says, and anything that needs a human.",
    render: () => (
      <>
        <ClockEvidenceReport />
        <ClockAnomalies />
      </>
    ),
  },
];

export default function ClockSettingsClient() {
  return (
    <Tabs defaultValue="rules" className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Attendance Settings</h1>
        <p className="text-sm text-muted-foreground">
          Rules, places, tags and reports for clocking in and out. Leave rules
          live under Leave Management.
        </p>
      </div>

      <TabsList>
        {TABS.map((t) => (
          <TabsTrigger key={t.value} value={t.value}>
            {t.label}
          </TabsTrigger>
        ))}
      </TabsList>

      {TABS.map((t) => (
        <TabsContent key={t.value} value={t.value} className="space-y-6">
          <p className="text-xs text-muted-foreground">{t.blurb}</p>
          {t.render()}
        </TabsContent>
      ))}
    </Tabs>
  );
}
