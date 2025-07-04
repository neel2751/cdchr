"use client";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Clock, Coffee, LogOut } from "lucide-react";
import { useEffect, useState } from "react";

export default function TimeTracker() {
  const [clockedIn, setClockedIn] = useState(false); // this come from the database if alreday in the database show true other wise false
  const [elapsedTime, setElapsedTime] = useState(0);

  const formatTime = (seconds) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hours.toString().padStart(2, "0")}:${minutes
      .toString()
      .padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  useEffect(() => {
    const timer = setInterval(() => {
      if (clockedIn) {
        setElapsedTime((prev) => prev + 1);
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [clockedIn]);

  // Handle ClockIn, ClockOut, handleBreak, onHoliday

  const handleClockIn = () => {
    // do something...
    setClockedIn(true);
    setElapsedTime(0);
  };

  const handleClockOut = () => {
    // do something...
  };

  const handleBreak = () => {
    //do something...
  };

  const onHoliday = false;
  const onBreak = false;

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Time Tracker</CardTitle>
          <CardDescription>Track your working hours and breaks</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center space-y-4">
            <div className="text-4xl font-bold font-mono">
              {formatTime(elapsedTime)}
            </div>

            <div className="flex space-x-2">
              {onHoliday ? (
                <Badge variant="destructive">On Holiday</Badge>
              ) : clockedIn ? (
                <Badge variant="default">Clocked In</Badge>
              ) : (
                <Badge variant="outline">Clocked Out</Badge>
              )}

              {onBreak && <Badge variant="secondary">On Break</Badge>}
            </div>

            <div className="flex space-x-4 mt-4">
              <Button
                onClick={handleClockIn}
                disabled={clockedIn || onHoliday}
                className="flex items-center gap-2"
              >
                <Clock className="h-4 w-4" />
                Clock In
              </Button>

              <Button
                onClick={handleBreak}
                disabled={!clockedIn || onHoliday}
                variant={onBreak ? "default" : "outline"}
                className="flex items-center gap-2"
              >
                <Coffee className="h-4 w-4" />
                {onBreak ? "End Break" : "Take Break"}
              </Button>

              <Button
                onClick={handleClockOut}
                disabled={!clockedIn || onHoliday}
                variant="destructive"
                className="flex items-center gap-2"
              >
                <LogOut className="h-4 w-4" />
                Clock Out
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Today's Activity</CardTitle>
          <CardDescription></CardDescription>
        </CardHeader>
        <CardContent></CardContent>
      </Card>
    </div>
  );
}
