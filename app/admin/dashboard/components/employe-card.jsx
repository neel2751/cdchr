"use client";

import CardName from "../../_components/name";
import EmployeeClockCard from "./employeeClockCard";

/**
 * The employee half of the dashboard.
 *
 * This used to import a whole *page* component — app/hr/employeeScan/page —
 * and drop it in a `max-w-xl mx-auto mt-20` box, which put the one thing
 * somebody came here to do below the fold on a laptop. The scanner dialog is
 * still that file's, because it is the mechanism; what surrounds it is now a
 * card that answers "am I clocked in" before asking anything.
 */
export default function EmployeCard() {
  return (
    <div className="container mx-auto space-y-4 p-4">
      <CardName />
      <div className="mx-auto w-full max-w-xl">
        <EmployeeClockCard />
      </div>
    </div>
  );
}
