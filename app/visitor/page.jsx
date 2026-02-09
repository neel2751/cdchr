"use client";
import React from "react";
import { ConsultationBooking } from "../hr/booking";
import { Button } from "@/components/ui/button";
import { reportAllAttendanceData } from "@/server/timeOffServer/updateClockServer";

export default function Page() {
  const handleDownload = async () => {
    const attendanceData = await reportAllAttendanceData();
    // alreday in csv format
    const csvData = attendanceData.data;

    const blob = new Blob([csvData], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "attendance_data.csv";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <Button onClick={handleDownload} variant="outline">
      Download Attendance Data
    </Button>
    // <ConsultationBooking />
  );
}
