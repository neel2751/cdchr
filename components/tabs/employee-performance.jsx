"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardTitle,
} from "@/components/ui/card";
import { ChevronLeft, ChevronRight, Clock, CalendarIcon } from "lucide-react";
import {
  format,
  addDays,
  startOfWeek,
  addWeeks,
  subWeeks,
  isSameDay,
} from "date-fns";
import { useAvatar } from "../Avatar/AvatarContext";
import { useFetchQuery } from "@/hooks/use-query";
import { getWeeklyRotaByWeekStartDate } from "@/server/weeklyRotaServer/weeklyRotaServer";

const daysOfWeek = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export default function EmployeePerformance() {
  const { slug } = useAvatar();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [weekStart, setWeekStart] = useState(
    startOfWeek(currentDate, { weekStartsOn: 1 })
  );
  const { data } = useFetchQuery({
    fetchFn: getWeeklyRotaByWeekStartDate,
    params: {
      employeeId: slug[0],
      date: format(weekStart, "yyyy-MM-dd"),
    },
    queryKey: [
      "getWeeklyRotaByWeekStartDate",
      slug[0],
      format(weekStart, "yyyy-MM-dd"),
    ],
    enabled: !!slug[0],
  });
  const { newData } = data || {};
  const shifts = newData?.attendanceData[0]?.schedule || [];
  console.log("shifts", shifts);

  const handlePreviousWeek = () => {
    const newWeekStart = subWeeks(weekStart, 1);
    setWeekStart(newWeekStart);
  };

  const handleNextWeek = () => {
    const newWeekStart = addWeeks(weekStart, 1);
    setWeekStart(newWeekStart);
  };

  const handleToday = () => {
    const today = new Date();
    setCurrentDate(today);
    setWeekStart(startOfWeek(today, { weekStartsOn: 1 }));
  };

  const shiftColor = (category) => {
    switch (category) {
      case "OFFICE":
        return "bg-indigo-100 border-indigo-300 text-indigo-800";
      case "OFFICE/SITE":
        return "bg-green-100 border-green-300 text-green-800";
      case "Work from Home":
        return "bg-yellow-100 border-yellow-300 text-yellow-800";
      case "OFF":
        return "bg-red-100 border-red-300 text-red-800";
      default:
        return "bg-gray-100 border-gray-300 text-gray-800";
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <CardTitle>
            <CalendarIcon className="w-4 h-4 inline mr-1" />
            Weekly Shifts
          </CardTitle>
          <CardDescription>
            View your weekly shifts. You can navigate through the weeks or jump
            to today.
          </CardDescription>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleToday}>
            Today
          </Button>
          <Button variant="outline" size="icon" onClick={handlePreviousWeek}>
            <ChevronLeft className="h-4 w-4 mr-1" />
          </Button>
          <Button variant="outline" size="icon" onClick={handleNextWeek}>
            <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      </div>

      <div className="text-center my-10">
        <CardTitle className="flex items-center justify-center gap-2">
          <CalendarIcon className="w-4 h-4" />
          Week of {format(weekStart, "MMMM d, yyyy")}
        </CardTitle>
      </div>

      <div className="grid grid-cols-6 gap-4">
        {daysOfWeek.map((day, index) => {
          const date = addDays(weekStart, index);
          const isToday = isSameDay(date, new Date());
          const dayShifts = shifts.filter((shift) =>
            isSameDay(shift.date, date)
          );

          return (
            <div key={day} className="min-h-36">
              <div
                className={`text-center p-2 rounded-t-md ${
                  isToday ? "bg-primary text-primary-foreground" : "bg-muted"
                }`}
              >
                <p className="font-medium">{day}</p>
                <p className="text-sm">{format(date, "MMM d")}</p>
              </div>
              <div className="border border-t-0 rounded-b-md max-h-max overflow-y-auto">
                {dayShifts && dayShifts.length > 0 ? (
                  dayShifts.map((shift, index) => (
                    <Card
                      key={shift.index}
                      className={`overflow-hidden border rounded-b-md rounded-t-none ${shiftColor(
                        shift.category
                      )}`}
                    >
                      <CardContent className="p-3">
                        {shift.category !== "OFF" ? (
                          <>
                            <div>
                              <Clock className="h-4 w-4 inline mr-1" />
                              <span className="text-sm">{shift.startTime}</span>
                            </div>
                            <div>
                              <Clock className="h-4 w-4 inline mr-1" />
                              <span className="text-sm">{shift.endTime}</span>
                            </div>
                            <p className="text-xs mt-1">{shift.category}</p>
                          </>
                        ) : (
                          <p className="text-xs mt-0.5">{shift.category}</p>
                        )}
                        {shift.category === "OFFICE/SITE" && (
                          <p className="text-xs mt-0.5">
                            <span className="font-medium">Site:</span>{" "}
                            {shift.site}
                          </p>
                        )}
                      </CardContent>
                    </Card>
                  ))
                ) : (
                  <p className="text-xs text-center text-muted-foreground py-4">
                    No shifts
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
