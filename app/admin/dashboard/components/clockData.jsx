"use client";
import { DatePickerWithRange } from "@/components/form/formFields";
import { useFetchQuery } from "@/hooks/use-query";
import { fetchLiveOfficeClock } from "@/server/timeOffServer/timeOffServer";
import { addDays, startOfWeek } from "date-fns";
import { useSession } from "next-auth/react";
import React from "react";

export default function ClockData({ searchParams }) {
  const page = parseInt(searchParams?.page || "1");
  const pageSize = parseInt(searchParams?.pageSize || "10");
  const { data: session } = useSession();
  const employeeId = session?.user?._id;

  const monday = startOfWeek(new Date(), { weekStartsOn: 1 });

  const [date, setDate] = React.useState({
    from: new Date(monday),
    to: addDays(new Date(monday), 6),
  });

  const { data } = useFetchQuery({
    fetchFn: fetchLiveOfficeClock,
    queryKey: ["liveOfficeClock", date?.from, date?.to, page, pageSize],
    params: {
      fromDate: date?.from || new Date(),
      toDate: date?.to || new Date(),
      page: page,
      pageSize: pageSize,
      employeeId: employeeId,
    },
    enabled: !!employeeId,
  });
  const { newData: clockData, isLoading, isError } = data || {};

  return (
    <div>
      <DatePickerWithRange date={date} setDate={setDate} />
      {clockData?.map((item, index) => (
        <div key={index}>
          <p>Employee ID: {item.name}</p>
          <p>Clock In: {item.clockIn}</p>
          <p>Break In: {item.breakIn}</p>
          <p>Break Out: {item.breakOut}</p>
          <p>Clock Out: {item.clockOut}</p>
        </div>
      ))}
    </div>
  );
}
