"use client";

import { useState, useEffect, useMemo } from "react";
import { format, startOfWeek, addWeeks, subWeeks } from "date-fns";
import { Button } from "@/components/ui/button";

import { CheckCheck, ChevronLeft, ChevronRight } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import AddCategory from "./components/addCategory";
import { SelectDatePicker } from "./components/dateSelect";
import { useFetchQuery } from "@/hooks/use-query";
import {
  getOfficeEmployeeAttendance,
  getOfficeEmployeeAttendanceWithLeave,
} from "@/server/officeAttendanceServer/officeAttendance";
import WeekRotaTable from "@/components/weekRotaTable/weekRotaTable";
import { Badge } from "@/components/ui/badge";

export function WeeklyRota() {
  const [currentWeek, setCurrentWeek] = useState(startOfWeek(new Date()));
  const queryKey = [
    "officeAttendance",
    { date: format(currentWeek, "yyyy-MM-dd") },
  ];

  const {
    data: queryData,
    isLoading,
    isError,
  } = useFetchQuery({
    params: {
      date: format(currentWeek, "yyyy-MM-dd"),
    },
    fetchFn: getOfficeEmployeeAttendanceWithLeave,
    queryKey,
  });

  const { newData = [] } = queryData || {};
  const memoizedSchedules = useMemo(() => newData, [newData]);
  const [schedules, setSchedules] = useState(newData);

  useEffect(() => {
    if (memoizedSchedules?.attendanceData?.length > 0) {
      setSchedules(memoizedSchedules?.attendanceData);
    }
  }, [newData]);

  const navigateWeek = (direction) => {
    setCurrentWeek((prev) =>
      direction === "prev" ? subWeeks(prev, 1) : addWeeks(prev, 1)
    );
  };

  return (
    <div className="p-4">
      <Card>
        <CardHeader>
          <div className="mb-8">
            <CardTitle>Weekly Schedules</CardTitle>
            <CardDescription>
              {`Week of: ${format(currentWeek, "MMMM d, yyyy")}`}
            </CardDescription>
          </div>
          <div className="flex justify-between items-centers">
            <SelectDatePicker
              date={currentWeek}
              setDate={setCurrentWeek}
              isLoading={isLoading}
            />
            <AddCategory />
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between mb-4">
            <Button
              disabled={isLoading}
              type="button"
              onClick={() => navigateWeek("prev")}
              variant="outline"
              size="icon"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="font-semibold inline-flex items-center gap-2">
              Week of: {format(currentWeek, "MMMM d, yyyy")}
              {memoizedSchedules?.approvedBy && (
                <Badge
                  variant={"outline"}
                  className={`border-none text-indigo-600 w-max flex items-center gap-1`}
                >
                  <CheckCheck className="h-4 w-4" />
                  <span>Submited by {memoizedSchedules?.approvedBy}</span>
                </Badge>
              )}
            </span>
            <Button
              disabled={isLoading}
              onClick={() => navigateWeek("next")}
              variant="outline"
              size="icon"
              type="button"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <WeekRotaTable
            currentWeek={currentWeek}
            schedules={schedules}
            setSchedules={setSchedules}
            memoizedSchedules={memoizedSchedules}
            isLoading={isLoading}
            queryKey={queryKey}
          />
        </CardContent>
      </Card>
    </div>
  );
}
