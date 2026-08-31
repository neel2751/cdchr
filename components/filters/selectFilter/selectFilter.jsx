"use client";
import React from "react";
import { useQueryState, parseAsString } from "nuqs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * Radix rejects an empty string as an item value, so "no filter" needs a
 * stand-in. Chosen here and translated back to an absent parameter, which keeps
 * the sentinel out of the URL.
 */
const CLEARED = "__all__";

/**
 * A dropdown that filters through the URL.
 *
 * @param {string} name the query parameter to write
 * @param {string} label placeholder shown when nothing is selected
 * @param {Array<{value: string, label: string}>} options
 * @param {string} [allLabel] adds a "clear this filter" entry. Without it a
 *   filter can be set from the dropdown but never unset, which is how this
 *   component behaved before.
 */
export function SelectFilter({ name, label, options, allLabel }) {
  const [isLoading, startTransition] = React.useTransition();

  const [value, setValue] = useQueryState(
    name,
    parseAsString.withDefault("").withOptions({
      startTransition,
      clearOnDefault: true,
      shallow: false,
      throttleMs: 500,
    })
  );

  const onChange = (next) => setValue(next === CLEARED ? "" : next);

  return (
    <div className="space-y-1">
      <Select
        value={value || (allLabel ? CLEARED : "")}
        onValueChange={onChange}
        disabled={isLoading}
      >
        {/* There is no visible <label> here, only a placeholder that vanishes
            once something is chosen — so the trigger has to name itself. */}
        <SelectTrigger id={name} aria-label={label} className="w-full">
          <SelectValue placeholder={label} />
        </SelectTrigger>
        <SelectContent>
          {allLabel && <SelectItem value={CLEARED}>{allLabel}</SelectItem>}
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
