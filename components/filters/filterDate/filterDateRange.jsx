"use client";
import { useEffect, useState, useTransition } from "react";
import { parseAsString, useQueryState } from "nuqs";
import {
  DatePickerSingle,
  DatePickerWithRange,
} from "@/components/form/formFields";
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

export function DateFilter({ name, label }) {
  const [loading, startTransition] = useTransition();
  const [date, setDate] = useQueryState(
    name,
    parseAsString.withDefault(format(new Date(), "yyyy-MM-dd")).withOptions({
      startTransition,
      clearOnDefault: true,
      shallow: false,
      throttleMs: 500,
    })
  );

  const [selectedDate, setSelectedDate] = useState(
    parse(date, "yyyy-MM-dd", new Date())
  );

  // 🔥 Keep local state in sync with query param
  useEffect(() => {
    if (date) {
      setSelectedDate(parse(date, "yyyy-MM-dd", new Date()));
    }
  }, [date]);

  const setSelectedDateRange = (newDate) => {
    startTransition(() => {
      setSelectedDate(newDate);
      setDate(format(newDate, "yyyy-MM-dd"));
    });
  };

  return (
    <div className="flex flex-col gap-2">
      {/* <Label>{label}</Label> */}
      <DatePickerSingle date={selectedDate} setDate={setSelectedDateRange} />
    </div>
  );
}
