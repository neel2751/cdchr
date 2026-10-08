"use client";

import { useMemo } from "react";

import {
  getLeaveYearString,
  leaveYearLabel,
  leaveYearStartYear,
} from "@/helper/getLeaveYearString";
import { useFetchQuery } from "@/hooks/use-query";
import { getLeaveSettingsClient } from "@/server/leaveSettingServer";

/** Last two leave years, this one, and the next — enough for any filter here. */
const DEFAULT_YEARS = [-2, -1, 0, 1];

/**
 * The company's leave year, for screens that show or filter by one.
 *
 * Every client screen that needed "the current leave year" called
 * `getLeaveYearString(new Date())` and got April, because that is the default
 * parameter — so on a company running any other leave year the filter opened on
 * the wrong twelve months, the wrong row was marked "(Current)", and the table
 * below was fetched for a year the company is not in. Between January and March
 * that is wrong for a quarter of the year even in the cases where the label
 * happens to agree.
 *
 * The start month is a per-company setting, so it has to be fetched. The query
 * key is the one CarryForwardSettings already uses, so a screen showing both
 * costs one request rather than two.
 *
 * Falls back to April while the setting is in flight or if it cannot be read,
 * which is the behaviour every one of these screens had unconditionally before —
 * so the worst case is what used to be the only case.
 *
 * @param {{ years?: number[] }} [options] `years` are offsets from the current
 *   leave year to offer in a dropdown; defaults to last year through next.
 * @returns {{
 *   startMonth: number,
 *   currentLeaveYear: string,
 *   currentStartYear: number,
 *   options: { value: string, startYear: number, isCurrent: boolean }[],
 *   isLoading: boolean,
 * }}
 */
export function useLeaveYear({ years = DEFAULT_YEARS } = {}) {
  const { data, isLoading } = useFetchQuery({
    queryKey: ["leave-settings"],
    fetchFn: getLeaveSettingsClient,
  });

  // Depended on by contents rather than identity, so a call site passing a
  // literal array does not rebuild the result on every render. Extracted to its
  // own variable because a dependency array may only hold plain expressions.
  const yearKey = years.join(",");

  const startMonth = useMemo(() => {
    const month = Number(data?.newData?.leaveYearStartMonth);
    return Number.isInteger(month) && month >= 1 && month <= 12 ? month : 4;
  }, [data?.newData?.leaveYearStartMonth]);

  return useMemo(() => {
    const now = new Date();
    const currentStartYear = leaveYearStartYear(now, startMonth);

    return {
      startMonth,
      currentLeaveYear: getLeaveYearString(now, startMonth),
      currentStartYear,
      // Read from `years` but keyed on `yearKey` above: the array is a literal at
      // every call site, so its identity changes on every render and its contents
      // never do.
      options: years.map((offset) => {
        const startYear = currentStartYear + offset;
        return {
          value: leaveYearLabel(startYear),
          startYear,
          isCurrent: offset === 0,
        };
      }),
      isLoading,
    };
    // `years` is deliberately keyed on its contents (yearKey) rather than listed:
    // it is an array literal at every call site, so its identity changes on every
    // render while its contents never do.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startMonth, isLoading, yearKey]);
}

export default useLeaveYear;
