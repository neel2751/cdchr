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
import { useFetchQuery } from "@/hooks/use-query";
import { getWeeklyRotaByWeekStartDate } from "@/server/weeklyRotaServer/weeklyRotaServer";
import { useAvatar } from "../Avatar/AvatarContext";
import { isOff, kindColour, needsPlace } from "@/lib/rotaCategories";
import { useTerms } from "@/app/admin/providers";

const daysOfWeek = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export default function EmployeeWeeklyRota() {
  const { t } = useTerms();
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

  // Coloured by each day's rule (lib/rotaCategories.js), not its name.
  const shiftColor = (shift) => kindColour(shift);

  return (
    <div className="space-y-6">
      <div className="flex sm:flex-row flex-col justify-between sm:items-center">
        <div className="space-y-1">
          <CardTitle>Weekly Shifts</CardTitle>
          <CardDescription>
            View your weekly shifts. You can navigate through the weeks or jump
            to today.
          </CardDescription>
        </div>
        <div className="flex gap-2 sm:mt-0 mt-4">
          <Button variant="outline" onClick={handleToday}>
            Today
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={handlePreviousWeek}
            className={"sm:flex hidden"}
          >
            <ChevronLeft className="h-4 w-4 mr-1" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={handleNextWeek}
            className={"sm:flex hidden"}
          >
            <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      </div>

      <div className="text-center my-10">
        <CardTitle className="flex items-center sm:justify-center justify-between gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={handlePreviousWeek}
            className={"sm:hidden"}
          >
            <ChevronLeft className="h-4 w-4 mr-1" />
          </Button>
          <div className="flex items-center gap-2">
            <CalendarIcon className="w-4 h-4 sm:block hidden" />
            Week of {format(weekStart, "MMMM d, yyyy")}
          </div>
          <Button
            variant="outline"
            size="icon"
            onClick={handleNextWeek}
            className={"sm:hidden"}
          >
            <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </CardTitle>
      </div>

      <div className="grid sm:grid-cols-6 grid-cols-2 gap-4">
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
                      key={index}
                      className={`overflow-hidden border rounded-b-md rounded-t-none ${shiftColor(shift)}`}
                    >
                      <CardContent className="p-3">
                        {!isOff(shift) ? (
                          <>
                            <div>
                              <Clock className="h-4 w-4 inline mr-1" />
                              <span className="text-sm">{shift.startTime}</span>
                            </div>
                            <div>
                              <Clock className="h-4 w-4 inline mr-1" />
                              <span className="text-sm">{shift.endTime}</span>
                            </div>
                            <p className="text-xs mt-1">{shift.label || shift.category}</p>
                          </>
                        ) : (
                          <p className="text-xs mt-0.5">{shift.label || shift.category}</p>
                        )}
                        {needsPlace(shift) && (
                          <p className="text-xs mt-0.5">
                            <span className="font-medium">{t("site")}:</span>{" "}
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
