import { useQuery } from "@tanstack/react-query";
import { getBankHolidays } from "@/server/holidayServer/holidayServer";

export const useBankHoliday = () => {
  return useQuery({
    queryKey: ["bank-holiday"],
    queryFn: async () => {
      // gov.uk is unreachable from the browser under our CSP, so the fetch
      // happens in a server action.
      const response = await getBankHolidays();
      if (!response?.success) {
        throw new Error(response?.message || "Could not load bank holidays");
      }
      return JSON.parse(response.data);
    },
    // The published list changes a handful of times a year.
    staleTime: 1000 * 60 * 60,
  });
};
