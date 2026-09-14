"use client";

import React from "react";
import Shimmer from "@/components/tableStatus/tableLoader";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useFetchQuery } from "@/hooks/use-query";
import { useCommonContext } from "@/context/commonContext";
import { formatDates } from "@/lib/formatDate";
import { getLeaveRequestDataAdmin } from "@/server/leaveServer/getLeaveServer";
import { format } from "date-fns";
import { ChevronDown, ChevronRight } from "lucide-react";
import { PaginationWithLinks } from "@/components/filters/pagination/pagination-client";
import { SelectFilter } from "@/components/filters/selectFilter/selectFilter";
import { EmployeeFilter } from "@/components/filters/selectFilter/employeeFilter";
import { DateRangeFilter } from "@/components/filters/filterDate/filterDateRange";
import {
  getLeaveYearString,
  getPreviousLeaveYearString,
} from "@/helper/getLeaveYearString";
import LeaveDetailsSheet from "../leaveRequest/leave-details-sheet";
import {
  LeaveStatusCell,
  NoticeGiven,
} from "../leaveRequest/leave-status-cell";

const HEADERS = [
  "Overlap",
  "Name",
  "Leave Type",
  "Submit Date",
  "Notice",
  "Status",
  "Actioned By",
  "Actioned On",
  "Note",
  "Dates",
  "Leave Days",
  "Details",
];

/**
 * A read-only record of leave that has already been settled.
 *
 * Deliberately not a second copy of the request table: approving, editing and
 * cancelling belong to the Request tab, and a request still awaiting a decision
 * is not history yet, so the query asks for decided requests only. The status
 * filter can still narrow that to a single outcome.
 */
const LeaveHistory = () => {
  const { searchParams } = useCommonContext();
  const currentPage = searchParams?.page || 1;
  const limit = searchParams?.pageSize || 10;
  const leaveYear = searchParams?.leaveYear || "";
  const leaveStatus = searchParams?.leaveStatus || "";
  const fromDate = searchParams?.fromDate || "";
  const toDate = searchParams?.toDate || "";
  const employeeId = searchParams?.employeeId || "";

  const queryKey = [
    "leave-history",
    currentPage,
    limit,
    leaveYear,
    leaveStatus,
    fromDate,
    toDate,
    employeeId,
  ];

  const { data, isPending } = useFetchQuery({
    params: {
      page: currentPage,
      limit,
      leaveYear,
      leaveStatus,
      fromDate,
      toDate,
      employeeId,
      decidedOnly: true,
    },
    queryKey,
    fetchFn: getLeaveRequestDataAdmin,
  });

  const { newData, totalCount } = data || {};

  const leaveYearString = getLeaveYearString(new Date());
  const leaveYears = [
    getPreviousLeaveYearString(leaveYearString),
    leaveYearString,
  ];

  return (
    <div className="mt-4">
      <Card>
        <CardHeader>
          <div className="space-y-1">
            <CardTitle>Leave History</CardTitle>
            <CardDescription>
              Leave that has already been approved, rejected, cancelled, expired
              or rolled back.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap justify-start items-center gap-4 mb-2">
            <DateRangeFilter />
            <div className="flex flex-wrap items-center gap-4">
              <EmployeeFilter />
              <SelectFilter
                name="leaveYear"
                label={"Leave Year"}
                options={leaveYears.map((year) => ({
                  label: year,
                  value: year,
                }))}
              />
              <SelectFilter
                name="leaveStatus"
                label={"Leave Status"}
                options={[
                  { label: "All", value: "All" },
                  { label: "Approved", value: "Approved" },
                  { label: "Cancelled", value: "Cancelled" },
                  { label: "Rejected", value: "Rejected" },
                  { label: "Expired", value: "Expired" },
                  { label: "Rolled Back", value: "Rolled Back" },
                ]}
              />
            </div>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                {HEADERS.map((head, index) => (
                  <TableHead className="text-xs uppercase" key={index}>
                    {head}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            {isPending ? (
              <Shimmer length={7} />
            ) : (
              <TableBody>
                {newData && newData.length > 0 ? (
                  newData.map((item, index) => (
                    <HistoryRow key={index} item={item} queryKey={queryKey} />
                  ))
                ) : (
                  <TableRow>
                    <TableCell
                      colSpan={HEADERS.length}
                      className="py-8 text-center text-sm text-muted-foreground"
                    >
                      No settled leave matches these filters.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            )}
          </Table>

          {totalCount > 0 && (
            <div className="flex justify-between items-center mt-4">
              <PaginationWithLinks totalCount={totalCount || 0} />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default LeaveHistory;

const HistoryRow = ({ item, queryKey }) => {
  const [isOpen, setIsOpen] = React.useState(false);
  const overlaps = item?.overlappingRequests || [];

  return (
    <>
      <TableRow>
        <TableCell>
          {overlaps.length > 0 ? (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsOpen(!isOpen)}
            >
              {overlaps.length}
              {isOpen ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </Button>
          ) : (
            <span className="text-muted-foreground">-</span>
          )}
        </TableCell>
        <TableCell>{item?.employee?.name || "-"}</TableCell>
        <TableCell>{item?.isHalfDay ? "Half Day" : item?.leaveType}</TableCell>
        <TableCell>
          {item?.leaveSubmitDate
            ? format(new Date(item.leaveSubmitDate), "PPP")
            : "-"}
        </TableCell>
        <TableCell>
          <NoticeGiven
            leaveStartDate={item?.leaveStartDate}
            leaveSubmitDate={item?.leaveSubmitDate}
          />
        </TableCell>
        <TableCell>
          {/* Read-only: history never offers approve or reject. */}
          <LeaveStatusCell leave={item} queryKey={queryKey} canReview={false} />
        </TableCell>
        <TableCell>{item?.approvedBy?.name || "-"}</TableCell>
        <TableCell>
          {item?.approvedDate
            ? format(new Date(item.approvedDate), "PPP")
            : "-"}
        </TableCell>
        <TableCell>
          <div className="w-10 overflow-ellipsis truncate">
            {item?.adminComment || "-"}
          </div>
        </TableCell>
        <TableCell>
          {formatDates(item?.leaveStartDate, item?.leaveEndDate)}
        </TableCell>
        <TableCell>{item?.leaveDays} days</TableCell>
        <TableCell>
          <LeaveDetailsSheet item={item} queryKey={queryKey} />
        </TableCell>
      </TableRow>

      <TableRow className="border-none">
        <TableCell colSpan={HEADERS.length} className="py-0">
          <Collapsible open={isOpen} onOpenChange={setIsOpen}>
            <CollapsibleContent className="py-2">
              <Card>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {[
                          "Name",
                          "Leave type",
                          "submit date",
                          "leave status",
                          "total days",
                          "dates",
                          "overlap days",
                        ].map((th, index) => (
                          <TableHead className="text-xs uppercase" key={index}>
                            {th}
                          </TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {overlaps.map((lh, idx) => (
                        <TableRow key={idx}>
                          <TableCell>{lh?.employeeName}</TableCell>
                          <TableCell>{lh?.leaveType}</TableCell>
                          <TableCell>
                            {lh?.leaveSubmitDate
                              ? format(new Date(lh.leaveSubmitDate), "PPP")
                              : "-"}
                          </TableCell>
                          <TableCell>
                            <LeaveStatusCell
                              leave={lh}
                              queryKey={queryKey}
                              canReview={false}
                            />
                          </TableCell>
                          {/* leaveDays as stored: counting the gap between the
                              first and last day overstates leave booked as
                              scattered dates. */}
                          <TableCell>{lh?.leaveDays} days</TableCell>
                          <TableCell>
                            {formatDates(lh?.leaveStartDate, lh?.leaveEndDate)}
                          </TableCell>
                          <TableCell>
                            <Badge className={"bg-indigo-600 text-white"}>
                              {lh?.overLappingDays} days
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </CollapsibleContent>
          </Collapsible>
        </TableCell>
      </TableRow>
    </>
  );
};
