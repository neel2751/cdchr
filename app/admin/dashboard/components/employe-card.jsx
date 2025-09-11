"use client";
import CardName from "../../_components/name";
import EmployeeClockScanner from "@/app/office/employeeScan/page";

export default function EmployeCard({ param }) {
  return (
    <div className="container mx-auto p-4 space-y-4">
      <CardName />
      {/* <ClockData serachParams={param} /> */}
      <div className="max-w-xl mx-auto mt-20">
        {/* <QRCodeSocket /> */}
        <EmployeeClockScanner />
        {/* <HowQRWork /> */}
      </div>
    </div>
  );
}
