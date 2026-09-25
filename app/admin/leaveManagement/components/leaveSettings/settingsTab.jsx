"use client";

import React from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import CarryForwardSettings from "./carryForwardSettings";

/**
 * Leave settings — and only leave settings.
 *
 * This tab used to hold ten cards, nine of which were about clocking in, tags,
 * hardware orders or invoices. They arrived here one at a time because this
 * was where a settings tab already existed, which is a bad reason, and the
 * result was that changing a clock-in rule meant opening the leave screens.
 *
 * They now live under Clock In Settings in the sidebar. The pointer below is
 * for contracted hours specifically, because leave genuinely depends on that
 * figure — a day of leave is valued from the contracted week — so somebody
 * looking for it here is not lost, they are following a real connection to the
 * one place it is now edited.
 */
export default function SettingsTab() {
  return (
    <div className="space-y-6">
      <CarryForwardSettings />

      <p className="text-xs text-muted-foreground">
        Contracted hours — which a day of leave is valued from — are set under{" "}
        <Link
          href="/admin/clockSettings"
          className="inline-flex items-center gap-0.5 text-indigo-600 underline"
        >
          Clock In Settings <ArrowUpRight className="size-3" />
        </Link>
        , alongside the attendance rules that use the same figure.
      </p>
    </div>
  );
}
