"use client";

import { useState, useMemo } from "react";
import {
  format,
  addDays,
  startOfWeek,
  isSameDay,
  differenceInMinutes,
  isWithinInterval,
  isBefore,
  startOfDay,
  parseISO,
  getMonth,
  getYear,
} from "date-fns";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { ConfirmationDialog } from "./confirmation-dialog";
import { EmployeeSidebar } from "./employee-sidebar";

export function ColumnCalendar({ employee, onRequestSubmit }) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedStartDate, setSelectedStartDate] = useState(null);
  const [selectedEndDate, setSelectedEndDate] = useState(null);
  const [selectedRange, setSelectedRange] = useState(null);

  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const timeSlots = useMemo(() => {
    const slots = [];
    const [startHour, startMinute] = employee.schedule.startTime
      .split(":")
      .map(Number);
    const [endHour, endMinute] = employee.schedule.endTime
      .split(":")
      .map(Number);

    const start = startHour * 60 + startMinute;
    const end = endHour * 60 + endMinute;

    for (let minutes = start; minutes < end; minutes += 30) {
      const hour = Math.floor(minutes / 60);
      const minute = minutes % 60;
      slots.push(
        `${hour.toString().padStart(2, "0")}:${minute
          .toString()
          .padStart(2, "0")}`
      );
    }
    return slots;
  }, [employee.schedule]);

  const weekStart = startOfWeek(currentDate, { weekStartsOn: 1 }); // Start from Monday
  const columns = Array.from({ length: 6 }, (_, i) => addDays(weekStart, i));

  const handleDateClick = (date) => {
    if (date.getDay() === 0 || isBefore(date, startOfDay(new Date()))) return; // Disable Sundays and past dates

    if (!selectedStartDate || (selectedStartDate && selectedEndDate)) {
      setSelectedStartDate(date);
      setCurrentDate(date);
      setSelectedEndDate(null);
      setSelectedRange(null);
    } else if (isBefore(date, selectedStartDate)) {
      setSelectedStartDate(date);
      setCurrentDate(date);
      setSelectedEndDate(selectedStartDate);
    } else {
      setSelectedEndDate(date);
      setCurrentDate(date);
    }
  };

  const handleTimeSlotClick = (date, time) => {
    if (date.getDay() === 0) return; // Disable Sundays
    setSelectedStartDate(date);
    setSelectedEndDate(date);

    if (!selectedRange) {
      // If no range is selected, start a new selection
      setSelectedRange({ start: time, end: time });
    } else if (time === selectedRange.start && time === selectedRange.end) {
      // If clicking on the only selected time, deselect it
      setSelectedRange(null);
    } else if (time === selectedRange.start) {
      // If clicking on the start time, adjust the start time
      setSelectedRange((prev) => (prev ? { ...prev, start: prev.end } : null));
    } else if (time === selectedRange.end) {
      // If clicking on the end time, adjust the end time
      setSelectedRange((prev) => (prev ? { ...prev, end: prev.start } : null));
    } else {
      // Adjust the range based on the clicked time
      const [startHour, startMinute] = selectedRange.start
        .split(":")
        .map(Number);
      const [endHour, endMinute] = time.split(":").map(Number);
      const startMinutes = startHour * 60 + startMinute;
      const endMinutes = endHour * 60 + endMinute;

      if (endMinutes < startMinutes) {
        setSelectedRange({ start: time, end: selectedRange.end });
      } else {
        setSelectedRange({ start: selectedRange.start, end: time });
      }
    }
  };

  const handleConfirm = (data) => {
    if (!selectedStartDate || !selectedEndDate || !selectedRange) return;
    onRequestSubmit({
      ...data,
      employeeId: employee.id,
      startDate: selectedStartDate,
      endDate: selectedEndDate,
      timeRange: selectedRange,
    });
    setIsDialogOpen(false);
    setSelectedStartDate(null);
    setSelectedEndDate(null);
    setSelectedRange(null);
  };

  const isInRange = (date, time) => {
    if (!selectedStartDate || !selectedEndDate || !selectedRange) return false;
    const isDateInRange = isWithinInterval(date, {
      start: selectedStartDate,
      end: selectedEndDate,
    });
    if (!isDateInRange) return false;

    const [hour, minute] = time.split(":").map(Number);
    const timeMinutes = hour * 60 + minute;
    const [startHour, startMinute] = selectedRange.start.split(":").map(Number);
    const [endHour, endMinute] = selectedRange.end.split(":").map(Number);
    const startMinutes = startHour * 60 + startMinute;
    const endMinutes = endHour * 60 + endMinute;
    return timeMinutes >= startMinutes && timeMinutes <= endMinutes;
  };

  //   const calculateTotalHours = () => {
  //     if (!selectedStartDate || !selectedEndDate || !selectedRange) return 0;
  //     const days =
  //       differenceInMinutes(selectedEndDate, selectedStartDate) / (24 * 60) + 1;
  //     const [startHour, startMinute] = selectedRange.start.split(":").map(Number);
  //     const [endHour, endMinute] = selectedRange.end.split(":").map(Number);
  //     const hoursPerDay =
  //       (endHour * 60 + endMinute - (startHour * 60 + startMinute)) / 60;
  //     return days * hoursPerDay;
  //   };

  const calculateTotalHours = () => {
    if (!selectedRange) return 0;
    const start = parseISO(`2000-01-01T${selectedRange.start}`);
    const end = parseISO(`2000-01-01T${selectedRange.end}`);
    return differenceInMinutes(end, start) / 60;
  };

  const isDateDisabled = (date) => {
    return date.getDay() === 0 || isBefore(date, startOfDay(new Date()));
  };

  const isTimeDisabled = (date, time) => {
    const now = new Date();
    const slotDateTime = new Date(date);
    const [hours, minutes] = time.split(":").map(Number);
    slotDateTime.setHours(hours, minutes);
    return isBefore(slotDateTime, now);
  };

  return (
    <div className="flex h-screen border rounded-lg mt-4 p-1">
      <EmployeeSidebar
        employee={employee}
        // selectedStartDate={selectedStartDate}
        // selectedEndDate={selectedEndDate}
        selectedDate={currentDate}
        onDateSelect={handleDateClick}
        disabledDates={isDateDisabled}
      />
      <div className="flex-1 flex flex-col">
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex items-center gap-4">
            <h2 className="font-semibold text-sm text-neutral-800">
              {getYear(addDays(weekStart, 5)) === weekStart.getFullYear()
                ? format(weekStart, "MMM d")
                : format(weekStart, "MMM d, yyyy")}{" "}
              -{" "}
              {getMonth(addDays(weekStart, 5)) === weekStart.getMonth()
                ? format(addDays(weekStart, 5), "d, yyyy")
                : format(addDays(weekStart, 5), "MMM d, yyyy")}
            </h2>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setCurrentDate(new Date());
                setSelectedStartDate(null);
                setSelectedEndDate(null);
                setSelectedRange(null);
              }}
            >
              Today
            </Button>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="border-indigo-400 group hover:bg-indigo-100"
              size="icon"
              onClick={() => setCurrentDate(addDays(currentDate, -7))}
            >
              <ChevronLeft className="h-4 w-4 text-indigo-600" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="border-indigo-400 group hover:bg-indigo-100"
              onClick={() => setCurrentDate(addDays(currentDate, 7))}
            >
              <ChevronRight className="h-4 w-4 text-indigo-600" />
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-auto">
          <div className="grid grid-cols-6 h-full divide-x">
            {columns.map((date) => (
              <div key={date.toISOString()} className="min-w-[150px]">
                <button
                  onClick={() => handleDateClick(date)}
                  disabled={isDateDisabled(date)}
                  className={cn(
                    "w-full sticky top-0 z-10 bg-background border-b p-3 text-neutral-800 text-pretty font-medium text-sm",
                    isWithinInterval(date, {
                      start: selectedStartDate || date,
                      end: selectedEndDate || date,
                    }) && "bg-accent",
                    isDateDisabled(date) && "cursor-not-allowed"
                  )}
                >
                  <div className="font-medium text-sm">
                    {format(date, "EEE")} {format(date, "d")}
                  </div>
                  <div
                    className={cn(
                      "text-sm",
                      isSameDay(date, new Date()) && "text-primary font-bold"
                    )}
                  >
                    {/* {format(date, "d")} */}
                  </div>
                </button>
                <div className="space-y-2 p-2">
                  {timeSlots.map((time) => (
                    <button
                      key={`${date.toISOString()}-${time}`}
                      onClick={() => handleTimeSlotClick(date, time)}
                      disabled={isTimeDisabled(date, time)}
                      className={cn(
                        "w-full p-2 text-sm hover:bg-accent border border-gray-300 rounded-md text-center",
                        isInRange(date, time) &&
                          " font-bold bg-indigo-100 text-indigo-600 border-indigo-600 hover:bg-indigo-200",
                        isTimeDisabled(date, time) &&
                          "opacity-50 cursor-not-allowed"
                      )}
                    >
                      {time}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {selectedRange && calculateTotalHours().toFixed(1) > 0 && (
          <div className="p-4 border-t">
            <Button
              onClick={() => setIsDialogOpen(true)}
              className="bg-linear-to-b from-indigo-700 to-indigo-900 text-white"
            >
              Request {calculateTotalHours().toFixed(1)} hours off
            </Button>
          </div>
        )}

        <ConfirmationDialog
          isOpen={isDialogOpen}
          onClose={() => setIsDialogOpen(false)}
          onConfirm={handleConfirm}
          selectedStartDate={selectedStartDate}
          selectedEndDate={selectedEndDate}
          selectedRange={selectedRange}
          totalHours={calculateTotalHours()}
        />

        {/* <ConfirmationDialog
          isOpen={isDialogOpen}
          onClose={() => setIsDialogOpen(false)}
          onConfirm={handleConfirm}
          selectedStartDate={selectedStartDate}
          selectedEndDate={selectedEndDate}
          selectedRange={selectedRange}
          selectedType={selectedType}
          totalHours={calculateTotalHours()}
        /> */}
      </div>
    </div>
  );
}
