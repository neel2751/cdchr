"use client";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { useTime } from "@/hooks/useTime";
import { format } from "date-fns";
import { Calendar } from "lucide-react";

export default function TimeInfo() {
  const currentTime = useTime();
  const formattedTime = format(currentTime, "hh:mm:ss a"); // 'hh' for 12-hour format, 'a' for AM/PM

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">Time Information</CardTitle>
        <Calendar className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{formattedTime}</div>
        <p className="text-xs text-muted-foreground">
          {format(currentTime, "PPP")}
        </p>
        <div className="mt-4">
          <p className="text-sm">Remaining Holiday: </p>
          <p className="text-sm">Hours this week: </p>
        </div>
      </CardContent>
    </Card>
  );
}
