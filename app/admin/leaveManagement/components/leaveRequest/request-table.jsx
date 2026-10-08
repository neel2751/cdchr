"use client";
import { Status } from "@/components/tableStatus/status";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useFetchQuery } from "@/hooks/use-query";
import {
  getLeaveRequestData,
  getLeaveRequestDataAdmin,
  rejectPastLeaveRequest,
} from "@/server/leaveServer/getLeaveServer";
import {
  differenceInCalendarDays,
  differenceInDays,
  format,
  isPast,
  isToday,
} from "date-fns";
import {
  ChevronDown,
  ChevronRight,
  EditIcon,
  Trash2Icon,
  UndoIcon,
} from "lucide-react";
import LeaveRequestStatus from "./request-status";
import LeaveForm from "./leave-form";
import React from "react";
import Shimmer from "@/components/tableStatus/tableLoader";
import { formatDates } from "@/lib/formatDate";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useSubmitMutation } from "@/hooks/use-mutate";
import { useCommonContext } from "@/context/commonContext";
import { PaginationWithLinks } from "@/components/filters/pagination/pagination-client";
import SearchDebounce from "@/components/search/searchDebounce";
import { SelectFilter } from "@/components/filters/selectFilter/selectFilter";
import { getPreviousLeaveYearString } from "@/helper/getLeaveYearString";
import { useLeaveYear } from "@/hooks/useLeaveYear";
import { DateRangeFilter } from "@/components/filters/filterDate/filterDateRange";
import { EmployeeFilter } from "@/components/filters/selectFilter/employeeFilter";
import { useSession } from "next-auth/react";
import LeaveDetailsSheet from "./leave-details-sheet";
import { LeaveRollbackDialog } from "./leave-rollback";

export function LeaveRequestTable({
  showDialog,
  setShowDialog,
  initialValues,
  handleEdit,
  handleSubmit,
  fields,
}) {
  const queryKey = ["employee-leave-request"];
  const { data } = useFetchQuery({
    queryKey,
    fetchFn: getLeaveRequestData,
  });
  const { newData = [] } = data || {};

  return (
    <Table>
      <TableHeader>
        <TableRow>
          {[
            newData[0]?.employee?.name && "Name",
            // newData[0]?.employee?.name && "Role Type",
            "Leave Type",
            "Submit Date",
            "Notice",
            "Status",
            "Admin",
            "Approve Date",
            "Note",
            "From",
            "to",
            "LeaveDays",
            "Action",
          ].map((item, index) => (
            <TableHead className="text-xs uppercase" key={index}>
              {item}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {newData?.map((item, index) => (
          <TableRow key={index}>
            {/* <TableCell>{index + 1}</TableCell> */}
            <TableCell>{item?.employee?.name}</TableCell>
            {/* <TableCell>{item?.employee?.role}</TableCell> */}
            <TableCell>
              {item?.isHalfDay ? "Half Day" : item?.leaveType}
            </TableCell>
            <TableCell>
              {format(item?.leaveSubmitDate || new Date(), "PPP")}
            </TableCell>
            <TableCell>
              {differenceInDays(
                item?.leaveStartDate || new Date(),
                item?.leaveSubmitDate || new Date()
              ) + 1}{" "}
              days
            </TableCell>
            <TableCell>
              {item?.leaveStatus === "Pending" && item?.employee?.name ? (
                <LeaveRequestStatus
                  leaveId={item?._id}
                  invalidateKey={queryKey}
                  leaveDate={item?.leaveStartDate}
                />
              ) : (
                <Status title={item?.leaveStatus} />
              )}
            </TableCell>
            <TableCell>{item?.approvedBy?.name || "-"}</TableCell>
            <TableCell>
              {item?.approvedDate
                ? format(item?.approvedDate || new Date(), "PPP")
                : "-"}
            </TableCell>
            <TableCell>{item?.adminComment || "-"}</TableCell>
            <TableCell>
              {format(item?.leaveStartDate || new Date(), "PPP")}
            </TableCell>
            <TableCell>
              {format(item?.leaveEndDate || new Date(), "PPP")}
            </TableCell>
            <TableCell>{item?.leaveDays} days</TableCell>
            <TableCell>
              {isPast(new Date(item?.leaveStartDate)) ||
                (item?.leaveStatus === "Pending" && (
                  <div className="flex gap-2 items-center">
                    <Button
                      size="icon"
                      variant="outline"
                      onClick={() => handleEdit(item)}
                    >
                      <EditIcon className="text-indigo-600" />
                    </Button>
                    <LeaveForm
                      fields={fields}
                      showDialog={showDialog}
                      setShowDialog={setShowDialog}
                      initialValues={initialValues}
                      handleSubmit={handleSubmit}
                    />
                    <Button size="icon" variant="outline">
                      <Trash2Icon className="text-rose-600" />
                    </Button>
                  </div>
                ))}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function LeaveRequestTableNew({ onEdit }) {
  const { searchParams } = useCommonContext();
  const currentPage = searchParams?.page || 1;
  const limit = searchParams?.pageSize || 10;
  const leaveYear = searchParams?.leaveYear || "";
  const leaveStatus = searchParams?.leaveStatus || "";
  const fromDate = searchParams?.fromDate || "";
  const toDate = searchParams?.toDate || "";
  const employeeId = searchParams?.employeeId || "";
  const { data: session } = useSession();
  const isSuperAdmin = session?.user?.role === "superAdmin";
  const queryKey = [
    "leave-superadmin",
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
      limit: limit,
      leaveStatus: leaveStatus,
      leaveYear: leaveYear,
      fromDate: fromDate,
      toDate: toDate,
      employeeId: employeeId,
    },
    queryKey,
    fetchFn: getLeaveRequestDataAdmin,
  });
  const { newData, totalCount } = data || {};
  const leaveYearsSet = new Set();
  // The company's leave year, not April's: getLeaveYearString defaults its
  // startMonth to 4, so this was the wrong twelve months for any company on
  // another leave year.
  const { currentLeaveYear: leaveYearString } = useLeaveYear();
  // we have leave year string like 2025-26 now we have to create one minus one year
  const previousLeaveYearString = getPreviousLeaveYearString(leaveYearString);
  leaveYearsSet.add(previousLeaveYearString);
  leaveYearsSet.add(leaveYearString);

  return (
    <div>
      <div className="flex flex-wrap justify-start items-center gap-4 mb-2">
        <DateRangeFilter />
        <div className="flex flex-wrap items-center gap-4">
          <EmployeeFilter />
          <SelectFilter
            name="leaveYear"
            label={"Leave Year"}
            options={Array.from(leaveYearsSet).map((year) => ({
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
              { label: "Pending", value: "Pending" },
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
            {[
              newData && newData[0]?.employee?.name && "Overlap",
              newData && newData[0]?.employee?.name && "Name",
              // newData[0]?.employee?.name && "Role Type",
              "Leave Type",
              "Submit Date",
              "Notice",
              "Status",
              "Admin",
              "Approve Date",
              "Note",
              "date requested",
              "LeaveDays",
              "Action",
            ].map((item, index) => (
              <TableHead className="text-xs uppercase" key={index}>
                {item}
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
                <DetailsRow
                  key={index}
                  item={item}
                  queryKey={queryKey}
                  onEdit={onEdit}
                  isSuperAdmin={isSuperAdmin}
                />
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={12}
                  className="py-8 text-center text-sm text-muted-foreground"
                >
                  No leave requests match these filters.
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
    </div>
  );
}

/**
 * How much warning the employee gave, counted in whole days from the submit
 * date to the first day of leave.
 *
 * A record entered after the leave was taken has no notice to report — it used
 * to show as a negative day count, which read as a data error rather than as
 * what it is: leave logged retrospectively.
 */
const NoticeGiven = ({ leaveStartDate, leaveSubmitDate }) => {
  if (!leaveStartDate || !leaveSubmitDate) return "-";

  const days = differenceInCalendarDays(
    new Date(leaveStartDate),
    new Date(leaveSubmitDate)
  );

  if (days < 0) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge className="bg-stone-100 text-stone-700 whitespace-nowrap shadow-none">
            Backdated
          </Badge>
        </TooltipTrigger>
        <TooltipContent>
          <p>Logged {Math.abs(days)} day(s) after the leave started</p>
        </TooltipContent>
      </Tooltip>
    );
  }

  if (days === 0) return "Same day";

  return `${days} day${days === 1 ? "" : "s"}`;
};

const DetailsRow = ({ item, queryKey, onEdit, isSuperAdmin }) => {
  const [isOpen, setIsOpen] = React.useState(false);
  const { mutate: handleExpire } = useSubmitMutation({
    mutationFn: async (id) => await rejectPastLeaveRequest(id),
    invalidateKey: queryKey,
  });

  return (
    <>
      <TableRow>
        {item?.employee?.name && (
          <>
            <TableCell>
              {item?.overlappingRequests?.length > 0 ? (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setIsOpen(!isOpen)}
                >
                  {item?.overlappingRequests.length}
                  {isOpen ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                </Button>
              ) : (
                <Button variant="ghost" size="icon">
                  -
                </Button>
              )}
            </TableCell>
            <TableCell>{item?.employee?.name}</TableCell>
          </>
        )}
        <TableCell>{item?.isHalfDay ? "Half Day" : item?.leaveType}</TableCell>
        <TableCell>
          {format(item?.leaveSubmitDate || new Date(), "PPP")}
        </TableCell>
        <TableCell>
          <NoticeGiven
            leaveStartDate={item?.leaveStartDate}
            leaveSubmitDate={item?.leaveSubmitDate}
          />
        </TableCell>
        <TableCell>
          {item?.leaveStatus === "Pending" && item?.employee?.name ? (
            isPast(new Date(item.leaveStartDate)) ? (
              // Leave is pending, but the start date has passed — auto mark as rejected
              <Status title="Expired" />
            ) : (
              // Today or future — allow approve & reject
              <LeaveRequestStatus
                leaveId={item._id}
                invalidateKey={queryKey}
                allowAccept={true}
                allowReject={true}
              />
            )
          ) : (
            // Not pending — just show actual status
            <Status title={item?.leaveStatus ?? "Unknown"} />
          )}
        </TableCell>
        <TableCell>{item?.approvedBy?.name || "-"}</TableCell>
        <TableCell>
          {item?.approvedDate
            ? format(item?.approvedDate || new Date(), "PPP")
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
          <div className="flex gap-2 items-center">
            {/* Always available: the full request, including every booked date,
                the sick note and any rollback the row has to leave out. */}
            <LeaveDetailsSheet
              item={item}
              queryKey={queryKey}
              isSuperAdmin={isSuperAdmin}
            />

            {/* Rollback: super admin only, and only once a leave is approved.
                The request is reversed, never deleted. */}
            {isSuperAdmin && item?.leaveStatus === "Approved" && (
              <LeaveRollbackDialog item={item} invalidateKey={queryKey} />
            )}

            {/* Edit Button and Form: Visible if NOT past, NOT today, AND Pending */}
            {!isPast(new Date(item?.leaveStartDate)) &&
              !isToday(new Date(item?.leaveStartDate)) &&
              item?.leaveStatus === "Pending" && (
                <>
                  <Button
                    size="icon"
                    variant="outline"
                    className="hover:bg-indigo-100 hover:border-indigo-600"
                    onClick={() => onEdit(item)}
                  >
                    <EditIcon className="text-indigo-600" />
                  </Button>
                </>
              )}

            {/* Delete Button: Visible if NOT past */}
            {item?.leaveStatus === "Pending" && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon"
                    variant="outline"
                    className="hover:bg-red-100 hover:border-red-600"
                    onClick={() => handleExpire(item._id)}
                  >
                    <UndoIcon className="text-rose-600" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Leave request expired</p>
                </TooltipContent>
              </Tooltip>
            )}
          </div>
        </TableCell>
      </TableRow>
      <TableRow className="border-none">
        <TableCell colSpan={12} className="py-0">
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
                      {item?.overlappingRequests
                        ? item?.overlappingRequests.map((lh, idx) => (
                            <TableRow key={idx}>
                              <TableCell>{lh?.employeeName}</TableCell>
                              <TableCell>{lh?.leaveType}</TableCell>
                              <TableCell>
                                {format(lh?.leaveSubmitDate, "PPP")}
                              </TableCell>
                              <TableCell>
                                {lh?.leaveStatus === "Pending" &&
                                item?.employee?.name ? (
                                  isPast(new Date(lh?.leaveStartDate)) ? (
                                    <LeaveRequestStatus
                                      invalidateKey={queryKey}
                                      leaveId={lh?._id}
                                      allowAccept={true}
                                      allowReject={true}
                                    />
                                  ) : isToday(new Date(lh.leaveStartDate)) ? (
                                    <LeaveRequestStatus
                                      leaveId={lh?._id}
                                      invalidateKey={queryKey}
                                      allowAccept={false}
                                      allowReject={true}
                                    />
                                  ) : (
                                    <LeaveRequestStatus
                                      leaveId={lh?._id}
                                      invalidateKey={queryKey}
                                      allowAccept={true}
                                      allowReject={true}
                                    />
                                  )
                                ) : isPast(lh?.leaveStartDate) ? (
                                  <Status title={"Rejected"} />
                                ) : (
                                  <Status title={lh?.leaveStatus} />
                                )}
                              </TableCell>

                              <TableCell>{lh?.leaveDays} days</TableCell>
                              <TableCell>
                                {formatDates(
                                  lh.leaveStartDate,
                                  lh.leaveEndDate
                                )}
                              </TableCell>
                              <TableCell>
                                <Badge className={"bg-indigo-600 text-white"}>
                                  {lh?.overLappingDays} days
                                </Badge>
                              </TableCell>
                            </TableRow>
                          ))
                        : null}
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
