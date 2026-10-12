import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "@/components/ui/table";
import { format } from "date-fns";
import Shimmer from "@/components/tableStatus/tableLoader";
import EmployeeUpdate from "./leave-employee-update";
import LeaveSheet from "./leave-sheet";
import LeaveScan from "./leave-scan";

export default function LeaveEntitlementTable({
  newData,
  isPending,
  queryKey,
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {[
            "Id",
            "name",
            "Department",
            "JoinDate",
            "EmployeeType",
            "WorkDays",
            "Action",
          ].map((item, index) => (
            <TableHead key={index} className="uppercase text-xs">
              {item}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      {isPending ? (
        <Shimmer length={7} />
      ) : (
        <TableBody>
          {newData &&
            newData?.map((item, index) => (
              <TableRow key={item?._id}>
                <TableCell>{index + 1}</TableCell>
                <TableCell>{item?.name}</TableCell>
                <TableCell>{item?.roleType}</TableCell>
                <TableCell>
                  {item?.joinDate
                    ? format(new Date(item?.joinDate || new Date()), "PPP")
                    : "Not Available"}
                </TableCell>
                <TableCell>{item?.employeType || "Not Available"}</TableCell>
                {/* "Not set", not a fabricated 5.

                    This read `item?.dayPerWeek || "5"`, so an employee with no
                    contracted days stored was shown as "5 days" — and the edit
                    button beside it appears precisely BECAUSE the value is
                    missing. The table said the record was complete while the
                    dialog, correctly, opened with the field empty, and the
                    dialog took the blame for it.

                    Five is not even the fallback. Pay and hours fall back to
                    the company's defaultDaysPerWeek (effectiveDaysPerWeek in
                    lib/workHours.js), which is configurable; statutory
                    entitlement does not fall back at all —
                    statutoryEntitlementDays returns 0 without it. So the one
                    reading nobody should be given is a number that looks
                    settled. */}
                <TableCell>
                  {item?.dayPerWeek ? (
                    `${item.dayPerWeek} days`
                  ) : (
                    <span
                      className="text-amber-600"
                      title="No contracted days recorded. Statutory entitlement is calculated from this and accrues as zero until it is set — use the edit button on this row."
                    >
                      Not set
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  <div className="space-x-3">
                    {(!item?.employeType || !item?.dayPerWeek) && (
                      <EmployeeUpdate item={item} queryKey={queryKey} />
                    )}
                    {item?.employeType && item?.leaveData && (
                      <LeaveSheet item={item} queryKey={queryKey} />
                    )}
                    {!item?.leaveData &&
                      item?.employeType &&
                      item?.dayPerWeek && (
                        <LeaveScan item={item} queryKey={queryKey} />
                      )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
        </TableBody>
      )}
    </Table>
  );
}
