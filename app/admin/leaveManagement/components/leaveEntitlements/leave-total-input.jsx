"use client";

import { Minus, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  isBelowStatutory,
  useEntitlementBounds,
} from "./useEntitlementBounds";

/**
 * The allowance being edited: minus, the number, plus.
 *
 * WHY A STEPPER. An entitlement is nearly always nudged rather than rewritten —
 * 28 to 30, 5 to 7 — and a bare number box makes the two gestures cost the same.
 * It also makes the typo the ceiling exists to catch much harder: 28 cannot
 * become 280 by pressing a button 252 times.
 *
 * WHY THE NUMBER IS STILL TYPEABLE. Because a stepper alone is unusable for the
 * types that start large. Unpaid Leave begins at 100 and may go to 366; Sick
 * Leave is often 130. Taking 100 to 250 one click at a time is not a feature, so
 * typing stays available for a genuine jump. Both paths are clamped to the same
 * range, and the server re-checks it regardless.
 *
 * Zero is reachable, deliberately — "no study leave this year" is a real thing to
 * record. What it is not is *accidental*: reaching it means either clicking down
 * to it or typing it, and then giving a reason, and for annual leave
 * acknowledging that it is below what the employee is owed.
 *
 * @param {Object} props
 * @param {Object} props.entitlement one row of `leaveData`
 * @param {Object} props.item the employee row — joinDate, dayPerWeek, endDate
 * @param {number|string} props.value the figure being edited
 * @param {(next: string) => void} props.onChange
 */
export default function LeaveTotalInput({
  entitlement,
  item,
  value,
  onChange,
  disabled,
}) {
  // The same bounds the save dialog uses, from the same hook — so the stepper
  // cannot refuse a figure the dialog would accept, or vice versa.
  const bounds = useEntitlementBounds({
    entitlement,
    employee: item,
    leaveYear: item?.leaveYear,
  });
  const { min, max, unit, statutory } = bounds;
  const leaveType = entitlement?.leaveType;

  const current = value === "" || value === null ? null : Number(value);
  const canStepDown = current !== null && current > min;
  const canStepUp = current !== null && current < max;

  /** Keep a step inside the range rather than letting it walk out of it. */
  const step = (by) => {
    const from = current === null ? min : current;
    const next = Math.min(Math.max(from + by, min), max);
    onChange(String(next));
  };

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1">
        <Button
          type="button"
          size="icon"
          variant="outline"
          className="size-7 shrink-0"
          onClick={() => step(-1)}
          disabled={disabled || !canStepDown}
          aria-label={`Reduce ${leaveType} by one ${unit.replace(/s$/, "")}`}
        >
          <Minus className="size-3" />
        </Button>

        <Input
          type="number"
          value={value ?? ""}
          min={min}
          max={max}
          step={1}
          disabled={disabled}
          aria-label={`${leaveType} total in ${unit}`}
          onChange={(event) => onChange(event.target.value)}
          // Clamped when the field is left rather than as it is typed: clamping
          // on every keystroke makes it impossible to type "30" when the minimum
          // is 4, because the leading "3" would be rewritten first.
          onBlur={(event) => {
            const raw = event.target.value;
            if (raw === "") return;
            const asNumber = Number(raw);
            if (!Number.isFinite(asNumber)) return;
            const clamped = Math.min(Math.max(Math.round(asNumber), min), max);
            if (clamped !== asNumber) onChange(String(clamped));
          }}
          className="h-7 w-14 text-center [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
        />

        <Button
          type="button"
          size="icon"
          variant="outline"
          className="size-7 shrink-0"
          onClick={() => step(1)}
          disabled={disabled || !canStepUp}
          aria-label={`Increase ${leaveType} by one ${unit.replace(/s$/, "")}`}
        >
          <Plus className="size-3" />
        </Button>

        <span className="text-xs text-muted-foreground">{unit}</span>
      </div>

      {/* The range, stated rather than discovered by hitting it. */}
      <p className="text-[11px] leading-tight text-muted-foreground">
        {min > 0 ? `${min}–${max}` : `0–${max}`}
        {min > 0 && " (days taken)"}
        {statutory !== null && (
          <>
            {" · "}
            <span
              className={
                isBelowStatutory(current, statutory)
                  ? "font-medium text-amber-600"
                  : ""
              }
            >
              entitled to {statutory}
            </span>
          </>
        )}
      </p>
    </div>
  );
}
