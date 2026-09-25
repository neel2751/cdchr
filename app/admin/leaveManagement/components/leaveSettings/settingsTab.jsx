"use client";

import React from "react";
import CarryForwardSettings from "./carryForwardSettings";
import ClockAnomalies from "./clockAnomalies";
import ClockEvidenceReport from "./clockEvidenceReport";
import ClockLocationRules from "./clockLocationRules";
import ClockLocationsSettings from "./clockLocationsSettings";
import ClockRulesSettings from "./clockRulesSettings";
import ClockTagsSettings from "./clockTagsSettings";
import TagOrderSettings from "./tagOrderSettings";
import InvoicesSettings from "./invoicesSettings";
import WorkHoursSettings from "./workHoursSettings";

/**
 * The Settings tab. Working time sits above the carry-forward rules because it
 * is the figure the attendance screens price leave from, so it is the one
 * people come here to check. Locations come next — the rules below them are
 * per-company today and per-location later, so the places have to be legible
 * first — then the clock rules, which govern what the scanner will accept.
 */
export default function SettingsTab() {
  return (
    <div className="space-y-6">
      <WorkHoursSettings />
      <ClockLocationsSettings />
      <ClockTagsSettings />
      <TagOrderSettings />
      <InvoicesSettings />
      <ClockLocationRules />
      <ClockEvidenceReport />
      <ClockAnomalies />
      <ClockRulesSettings />
      <CarryForwardSettings />
    </div>
  );
}
