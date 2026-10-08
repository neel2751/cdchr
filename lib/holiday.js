import { useQuery } from "@tanstack/react-query";
import { getBankHolidays } from "@/server/holidayServer/holidayServer";
import { getWorkSettings } from "@/server/settingsServer/workSettings";
import { isBankHoliday, toHolidaySet } from "@/lib/bankHolidays";

export const useBankHoliday = (region) => {
  return useQuery({
    // Keyed on the region, so switching it in Settings refetches rather than
    // serving the previous country's dates from cache.
    queryKey: ["bank-holiday", region || "england-and-wales"],
    queryFn: async () => {
      // gov.uk is unreachable from the browser under our CSP, so the fetch
      // happens in a server action.
      const response = await getBankHolidays(region);
      if (!response?.success) {
        throw new Error(response?.message || "Could not load bank holidays");
      }
      return JSON.parse(response.data);
    },
    // The published list changes a handful of times a year.
    staleTime: 1000 * 60 * 60,
  });
};

/**
 * Whether this company closes on bank holidays, and a predicate for the date
 * pickers.
 *
 * The forms use this to stop offering days the company does not charge for.
 * It is a courtesy, not the guarantee — `addLeaveRequest` applies the same rule
 * server-side, because a disabled day in a calendar only stops the people who
 * use the calendar.
 *
 * Fails open in the same direction as the server: until both queries have
 * answered, and whenever the company does not observe them, nothing is blocked.
 * Blocking a legitimate booking while a fetch is in flight is the worse error.
 */
export const useBankHolidayRule = () => {
  const { data: settings } = useQuery({
    queryKey: ["workSettings"],
    queryFn: async () => {
      const res = await getWorkSettings();
      return res?.data ? JSON.parse(res.data) : null;
    },
    staleTime: 1000 * 60 * 10,
  });

  const observes = settings?.observesBankHolidays === true;
  // Fetched for the company's own region — the lists genuinely differ, so a
  // Scottish company reading the England list would be blocked on the wrong
  // days and charged for its own.
  const { data: holidays } = useBankHoliday(settings?.bankHolidayRegion);
  const holidaySet = toHolidaySet(observes ? holidays : []);

  return {
    observes,
    /** The nation this company follows — the view tab starts here. */
    region: settings?.bankHolidayRegion || "england-and-wales",
    holidays: holidays || [],
    /** True when this date should be blocked in a leave picker. */
    isClosedDay: (date) =>
      observes && holidaySet.size > 0 && isBankHoliday(date, holidaySet),
  };
};
