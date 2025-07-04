"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ChevronLeft, ChevronRight, Clock, CalendarIcon } from "lucide-react";
import {
  format,
  addDays,
  startOfWeek,
  addWeeks,
  subWeeks,
  isSameDay,
} from "date-fns";
const daysOfWeek = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

export default function WeeklyRota() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [weekStart, setWeekStart] = useState(
    startOfWeek(currentDate, { weekStartsOn: 1 })
  );

  const [shifts, setShifts] = useState([
    {
      id: "1",
      date: addDays(weekStart, 0),
      startTime: "09:00",
      endTime: "17:00",
      role: "Project Manager",
      location: "Office",
      color: "bg-blue-100 border-blue-300 text-blue-800",
    },
    {
      id: "2",
      date: addDays(weekStart, 1),
      startTime: "09:00",
      endTime: "17:00",
      role: "Project Manager",
      location: "Office",
      color: "bg-blue-100 border-blue-300 text-blue-800",
    },
    {
      id: "3",
      date: addDays(weekStart, 2),
      startTime: "10:00",
      endTime: "18:00",
      role: "Team Lead",
      location: "Remote",
      color: "bg-purple-100 border-purple-300 text-purple-800",
    },
    {
      id: "4",
      date: addDays(weekStart, 3),
      startTime: "09:00",
      endTime: "17:00",
      role: "Project Manager",
      location: "Client Site",
      color: "bg-green-100 border-green-300 text-green-800",
    },
    {
      id: "5",
      date: addDays(weekStart, 4),
      startTime: "09:00",
      endTime: "15:00",
      role: "Project Manager",
      location: "Office",
      color: "bg-blue-100 border-blue-300 text-blue-800",
    },
  ]);

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

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-xl font-medium">Weekly Rota</h2>
          <p className="text-muted-foreground">
            View and manage your scheduled shifts
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handlePreviousWeek}>
            <ChevronLeft className="h-4 w-4 mr-1" />
            Previous
          </Button>
          <Button variant="outline" size="sm" onClick={handleToday}>
            Today
          </Button>
          <Button variant="outline" size="sm" onClick={handleNextWeek}>
            Next
            <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      </div>

      <div className="text-center mb-6">
        <h3 className="text-lg font-medium flex items-center justify-center">
          <CalendarIcon className="h-5 w-5 mr-2" />
          Week of {format(weekStart, "MMMM d, yyyy")}
        </h3>
      </div>

      <div className="grid grid-cols-7 gap-4">
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
              <div className="border border-t-0 rounded-b-md p-2 min-h-32">
                {dayShifts.length > 0 ? (
                  dayShifts.map((shift) => (
                    <Card
                      key={shift.id}
                      className={`mb-2 overflow-hidden border ${shift.color}`}
                    >
                      <CardContent className="p-3">
                        <div className="flex items-center gap-1 text-sm font-medium">
                          <Clock className="h-3.5 w-3.5" />
                          {shift.startTime} - {shift.endTime}
                        </div>
                        <p className="text-xs font-medium mt-1">{shift.role}</p>
                        <p className="text-xs mt-0.5">{shift.location}</p>
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

      <div className="mt-6 border rounded-md p-4">
        <h3 className="text-lg font-medium mb-3">Legend</h3>
        <div className="grid grid-cols-3 gap-4">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded-full bg-blue-300"></div>
            <span className="text-sm">Office</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded-full bg-green-300"></div>
            <span className="text-sm">Client Site</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded-full bg-purple-300"></div>
            <span className="text-sm">Remote</span>
          </div>
        </div>
      </div>
    </div>
  );
}
