import { useQuery } from "@tanstack/react-query";

export const fetchBankHoliday = async () => {
  const res = await fetch("https://www.gov.uk/bank-holidays.json");
  if (!res.ok) return null;
  const data = await res.json();
  const bankHolidays = data["england-and-wales"];
  // we need current and after dates
  const currentYear = new Date().getFullYear();
  // current and all after year
  const afterDates = bankHolidays.events.filter(
    (holiday) => new Date(holiday.date).getFullYear() >= currentYear
  );
  // This is current year data
  const currentAndAfterYearBankHoliday = bankHolidays.events.filter(
    (bankHoliday) => bankHoliday.date.includes(currentYear)
  );
  // return currentAndAfterYearBankHoliday;
  return afterDates;
};

export const useBankHoliday = () => {
  return useQuery({
    queryKey: ["bank-holiday"],
    queryFn: fetchBankHoliday,
    // staleTime set to infinite
    staleTime: Infinity,
  });
}; // This is the function that will be used to fetch the data
