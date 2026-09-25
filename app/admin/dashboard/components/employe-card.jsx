"use client";

import CardName from "../../_components/name";
import EmployeeClockCard from "./employeeClockCard";

/**
 * The clock, with the greeting above it.
 *
 * This used to import a whole *page* component — app/hr/employeeScan/page —
 * and drop it in a `max-w-xl mx-auto mt-20` box, which put the one thing
 * somebody came here to do below the fold on a laptop. The page owns the
 * width and the spacing now; this owns what goes in it.
 */
export default function EmployeCard() {
  return (
    <div className="space-y-3">
      <CardName />
      <EmployeeClockCard />
    </div>
  );
}
