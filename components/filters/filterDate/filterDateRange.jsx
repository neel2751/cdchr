"use client";
import { useState, useTransition } from "react";
import { parseAsIsoDate, parseAsString, useQueryState } from "nuqs";
import { Label } from "@/components/ui/label";
import { DatePickerWithRange } from "@/components/form/formFields";
import { format, parse } from "date-fns";

export function DateRangeFilter() {
  const [loading, startTransition] = useTransition();
  const [fromDate, setFromDate] = useQueryState(
    "fromDate",
    parseAsString.withDefault(format(new Date(), "yyyy-MM-dd")).withOptions({
      startTransition,
      clearOnDefault: true,
      shallow: false,
      throttleMs: 500,
    })
  );

  const [toDate, setToDate] = useQueryState(
    "toDate",
    parseAsString.withDefault(format(new Date(), "yyyy-MM-dd")).withOptions({
      startTransition,
      clearOnDefault: true,
      shallow: false,
      throttleMs: 500,
    })
  );

  // ✅ Use parse() instead of new Date()
  const [date, setDate] = useState({
    from: parse(fromDate, "yyyy-MM-dd", new Date()),
    to: parse(toDate, "yyyy-MM-dd", new Date()),
  });

  const setDateRange = (newDate) => {
    console.log("newDate", newDate);
    startTransition(() => {
      setDate(newDate);
      setFromDate(format(newDate.from, "yyyy-MM-dd"));
      setToDate(format(newDate.to, "yyyy-MM-dd"));
    });
  };

  return (
    <div className="flex flex-col gap-2">
      {/* <Label>Date Range</Label> */}
      <DatePickerWithRange date={date} setDate={setDateRange} />
    </div>
  );
}
