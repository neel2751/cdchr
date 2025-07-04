"use client";

import { useState } from "react";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function TimeOffCalendar({
  employeeId,
  defaultSchedule = {
    startTime: "09:00",
    endTime: "17:00",
    workDays: [1, 2, 3, 4, 5, 6], // Mon-Sat
  },
}) {
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [selectedTime, setSelectedTime] = useState("09:00");
  const [schedule, setSchedule] = useState(defaultSchedule);

  // Generate time slots based on schedule
  const getTimeSlots = () => {
    const slots = [];
    const [startHour] = schedule.startTime.split(":").map(Number);
    const [endHour] = schedule.endTime.split(":").map(Number);

    for (let hour = startHour; hour < endHour; hour++) {
      slots.push(`${hour.toString().padStart(2, "0")}:00`);
      slots.push(`${hour.toString().padStart(2, "0")}:30`);
    }
    return slots;
  };

  const handleTimeOffRequest = async () => {
    if (!selectedDate) return;

    const startDate = new Date(selectedDate);
    startDate.setHours(parseInt(selectedTime.split(":")[0]));

    // await requestTimeOff({
    //   employeeId,
    //   startDate,
    //   endDate: startDate, // For single day requests
    // })
  };

  return (
    <Card className="w-full max-w-4xl mx-auto">
      <CardHeader>
        <CardTitle>Request Time Off</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <Calendar
              mode="single"
              selected={selectedDate}
              onSelect={setSelectedDate}
              disabled={(date) => {
                const day = date.getDay();
                // Convert Sunday (0) to 7 for easier comparison
                const adjustedDay = day === 0 ? 7 : day;
                return !schedule.workDays.includes(adjustedDay);
              }}
              className="rounded-md border"
            />
          </div>
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-medium mb-2">Select Time</h3>
              <Select value={selectedTime} onValueChange={setSelectedTime}>
                <SelectTrigger>
                  <SelectValue placeholder="Select time" />
                </SelectTrigger>
                <SelectContent>
                  {getTimeSlots().map((time) => (
                    <SelectItem key={time} value={time}>
                      {time}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              onClick={handleTimeOffRequest}
              disabled={!selectedDate}
              className="w-full"
            >
              Request Time Off
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
