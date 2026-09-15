"use client";

import React from "react";
import CarryForwardSettings from "./carryForwardSettings";
import WorkHoursSettings from "./workHoursSettings";

/**
 * The Settings tab. Working time sits above the carry-forward rules because it
 * is the figure the attendance screens price leave from, so it is the one
 * people come here to check.
 */
export default function SettingsTab() {
  return (
    <div className="space-y-6">
      <WorkHoursSettings />
      <CarryForwardSettings />
    </div>
  );
}
