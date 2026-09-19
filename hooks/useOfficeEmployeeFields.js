"use client";

import { useMemo } from "react";
import { BANKFIELD, OFFICEFIELD } from "@/data/fields/fields";
import { useFetchQuery, useFetchSelectQuery } from "@/hooks/use-query";
import { useSelectCompany } from "@/hooks/useSelect/useSelect";
import { canViewSensitiveDetails } from "@/server/officeServer/sensitiveDetailsServer";
import { getSelectRoleType } from "@/server/selectServer/selectServer";
import { getWorkSettings } from "@/server/settingsServer/workSettings";

/**
 * OFFICEFIELD, ready to render.
 *
 * Three of its entries cannot be written down in data/fields/fields.js because
 * their choices come from the database — the department list, the company list,
 * and the company's own fixed-hours figure. Every screen that shows this form
 * therefore has to decorate the same three fields the same way, and until this
 * existed each one did it by hand.
 *
 * That is not a tidiness point. The employee Edit tab had drifted to showing
 * three fields out of thirty: it took OFFICEFIELD, filtered it down to name,
 * phone and email, and then re-listed a few of the other groups as separate
 * tabs — so address, working hours, date of birth and employee ID were simply
 * not editable from an employee's own page. A single decorated list, grouped
 * for display, means a field added to OFFICEFIELD turns up on both screens
 * instead of one.
 */

// A stable empty array. `useSelectCompany() || []` would hand back a fresh one
// on every render before the list loads, which is enough to defeat the useMemo
// below and rebuild the whole field list each time.
const EMPTY = [];

/** Fields only editable by someone allowed to read them. */
export const PROTECTED_FIELD_NAMES = [
  ...BANKFIELD.map((item) => item.name),
  "employeNI",
];

/**
 * @param {{ omit?: string[] }} [options] field names to leave out entirely —
 *   for a screen that deliberately does not edit them.
 * @returns {{
 *   fields: object[],
 *   byName: Record<string, object>,
 *   canSeeSensitiveDetails: boolean,
 *   selectRoleType: object[],
 *   selectCompany: object[],
 *   workSetting: object | undefined,
 * }}
 *
 * The three lookups are returned as well as applied. The staff list uses the
 * same department and company lists for its filter row, and React Query serves
 * both from one request per key — so handing them back here means that screen
 * does not have to re-declare the queries it already depends on.
 */
export function useOfficeEmployeeFields({ omit = [] } = {}) {
  const { data: selectRoleType = [] } = useFetchSelectQuery({
    queryKey: ["selectRoleType"],
    fetchFn: getSelectRoleType,
  });

  // Defaulted here rather than at the call site: these are spread, `.find`-ed
  // and `.length`-ed by callers, and the underlying hook returns undefined
  // until the first response lands.
  const selectCompany = useSelectCompany() ?? EMPTY;

  const { data: workSetting } = useFetchSelectQuery({
    fetchFn: getWorkSettings,
    queryKey: ["workSettings"],
  });

  const { data: sensitiveAccess } = useFetchQuery({
    fetchFn: canViewSensitiveDetails,
    queryKey: ["canViewSensitiveDetails"],
  });
  const canSeeSensitiveDetails = sensitiveAccess?.newData === true;

  const omitted = useMemo(() => new Set(omit), [omit]);

  const fields = useMemo(() => {
    return OFFICEFIELD.filter((item) => {
      if (omitted.has(item.name)) return false;
      // The server leaves the stored values alone when these are absent, so
      // dropping them is safe as well as correct.
      if (!canSeeSensitiveDetails && PROTECTED_FIELD_NAMES.includes(item.name)) {
        return false;
      }
      return true;
    }).map((item) => {
      if (item.name === "department") return { ...item, options: selectRoleType };
      if (item.name === "company") return { ...item, options: selectCompany };
      // Name the actual company figure in the option, so whoever is filling the
      // form can see what "fixed" means without opening Settings.
      if (item.name === "weeklyHourType") {
        return {
          ...item,
          options: [
            {
              value: "fixed",
              label: `Fixed hours (${workSetting?.fixedWeeklyHours ?? 40}h/week)`,
            },
            { value: "custom", label: "Custom hours" },
          ],
        };
      }
      return item;
    });
  }, [
    omitted,
    canSeeSensitiveDetails,
    selectRoleType,
    selectCompany,
    workSetting?.fixedWeeklyHours,
  ]);

  const byName = useMemo(
    () => Object.fromEntries(fields.map((item) => [item.name, item])),
    [fields]
  );

  return {
    fields,
    byName,
    canSeeSensitiveDetails,
    selectRoleType,
    selectCompany,
    workSetting,
  };
}
