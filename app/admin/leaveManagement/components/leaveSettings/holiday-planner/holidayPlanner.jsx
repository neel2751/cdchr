"use client";

import { useState } from "react";
import { useHolidayPlanner } from "@/hooks/useHolidayPlanner";
import CalendarHeader from "./calendarHeader";
import HolidayCalendar from "./holidayCalendar";

export default function HolidayPlannerPage() {
  const today = new Date();

  const [month, setMonth] = useState(today.getMonth());
  const [year, setYear] = useState(today.getFullYear());

  const { data, loading } = useHolidayPlanner({ month, year });

  return (
    <div className="p-6 space-y-4">
      <CalendarHeader
        month={month}
        year={year}
        onChangeMonth={setMonth}
        onChangeYear={setYear}
      />

      {loading ? (
        <div className="text-center py-20">Loading calendar…</div>
      ) : (
        <HolidayCalendar calendar={data || []} />
      )}
    </div>
  );
}
