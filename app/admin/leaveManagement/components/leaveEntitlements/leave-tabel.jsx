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
                <TableCell>{item?.dayPerWeek || "5"} days</TableCell>
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
