"use client";

import EmployeeOverview from "@/components/tabs/employee-overview";
// import LeaveRequests from "@/components/tabs/leave-requests";
import { useCommonContext } from "@/context/commonContext";
import { useFetchQuery } from "@/hooks/use-query";
import { employeeLeaveDetailsNew } from "@/server/officeServer/officeEmployeeDetails";
import React, { useId, useMemo, useState } from "react";
import LeaveCount from "../../leaveManagement/components/leaveDashboard/leaveCount";
import { Button } from "@/components/ui/button";
import { EditIcon, ListFilterIcon, PlusIcon, XIcon } from "lucide-react";
import LeaveRequestNew from "../../leaveManagement/components/leaveRequest/leave-request-new";
import { format, isPast } from "date-fns";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Status } from "@/components/tableStatus/status";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useAvatar } from "@/components/Avatar/AvatarContext";
import { useLeaveYear } from "@/hooks/useLeaveYear";
import { useSubmitMutation } from "@/hooks/use-mutate";
import { rejectPastLeaveRequest } from "@/server/leaveServer/getLeaveServer";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { getEmployeeLeaveData } from "@/server/leaveServer/leaveServer";
import LeaveSheet from "../../leaveManagement/components/leaveEntitlements/leave-sheet";
import SensitiveDetailsCard from "@/components/sensitiveDetails/sensitiveDetailsCard";
import RightToWorkCard from "@/components/rightToWork/rightToWorkCard";
import { formatDisplayDate } from "@/lib/formatDate";

const EmployeeOtherDeatils = () => {
  const { newData, slug } = useAvatar();
  const updateData = [
    {
      title: "Personal Details",
      content: [
        { label: "Employee ID", value: newData?.employeId || "-" },
        {
          label: "Date of Birth",
          value: formatDisplayDate(newData?.dateOfBirth),
        },
      ],
    },
    {
      title: "Immigration Deatils",
      content: [
        { label: "Nationality", value: newData?.immigrationType || "-" },
        { label: "Visa Type", value: newData?.immigrationCategory || "-" },
        { label: "Employee Type", value: newData?.employeType || "-" },
        // Employee NI lives in the password-protected card above.
        newData?.immigrationType !== "British" && {
          label: "Visa Start Date",
          value: formatDisplayDate(newData?.visaStartDate),
        },
        newData?.immigrationType !== "British" && {
          label: "Visa End Date",
          value: formatDisplayDate(newData?.visaEndDate),
        },

        // { label: "Join Date", value: "22 Sep, 2022" },
        // { label: "End Date", value: "10 Nov, 2023" },
      ],
    },
    {
      title: "Emergency Contact Details",
      content: [
        { label: "Name", value: newData?.emergencyName || "-" },
        { label: "Contact No", value: newData?.emergencyPhoneNumber || "-" },
        { label: "Address", value: newData?.emergencyAddress || "-" },
        { label: "Relation", value: newData?.emergencyRelation || "-" },
      ],
    },
  ];

  return (
    <div className="space-y-2">
      <SensitiveDetailsCard slug={slug} employeeType="office" />
      <EmployeeOverview data={updateData} />
      <RightToWorkCard
        immigrationType={newData?.immigrationType}
        visaEndDate={newData?.visaEndDate}
        checks={newData?.rightToWorkChecks}
      />
    </div>
  );
};

/** Leave years offered in the filter: three back, the current one, and next. */
const YEAR_OFFSETS = [-3, -2, -1, 0, 1];

// The leave year the filter opens on, and the years it offers, now come from
// useLeaveYear() — which reads the month the company's leave year actually
// starts in. They were built from lib/getLeaveYear.js, where April is
// hard-coded, so on any other leave year this filter opened on the wrong twelve
// months and marked the wrong row "(Current)".
const STATUSES = ["All", "Approved", "Pending", "Rejected"];

const EmployeeLeaveDeatails = () => {
  const { searchParams } = useCommonContext();
  // The employee this card is about. Used for the entitlement sheet's heading,
  // which had no way to know whose leave it was showing.
  const { newData: employeeRecord } = useAvatar();
  const [showDialog, setShowDialog] = useState(false);
  const [initialValues, setInitialValues] = useState(null);

  // These two used to be `defaultValue` on a pair of Selects with no handler
  // and no state behind them — the filter opened, the options were all there,
  // and picking one did nothing at all. The leave year was pinned to today's
  // and there was no way to look at any other.
  const { currentLeaveYear, options: leaveYearOptions } = useLeaveYear({
    years: YEAR_OFFSETS,
  });
  // Null until the company's leave year is known, then the current one. Not
  // seeded from a hard-coded April default, which would fetch the wrong year
  // once and cache it under that key.
  const [chosenLeaveYear, setLeaveYear] = useState(null);
  const leaveYear = chosenLeaveYear || currentLeaveYear;
  const [status, setStatus] = useState("All");

  // leaveYear belongs in the key: without it React Query answers the new year
  // from the previous year's cache entry.
  const queryKey = ["leaveDeatils", searchParams, leaveYear];
  const { data } = useFetchQuery({
    params: { searchParams, leaveYear },
    fetchFn: employeeLeaveDetailsNew,
    queryKey,
    enabled: !!searchParams,
  });

  // Was called with no params at all, so it answered for whoever was signed in
  // and for today's leave year — meaning HR opening someone else's Leave tab
  // saw their own entitlements under that person's name, and the year filter
  // above could not move it.
  const { data: commonLeave } = useFetchQuery({
    queryKey: ["commonLeave", searchParams, leaveYear],
    params: { slug: searchParams?.[0] ?? null, leaveYear },
    fetchFn: getEmployeeLeaveData,
  });

  const { newData: employeeCommonLeave } = commonLeave || {};

  const { mutate: deleteLeaveRequest } = useSubmitMutation({
    mutationFn: async (data) =>
      rejectPastLeaveRequest(data.leaveId, data.leaveStatus),
    invalidateKey: queryKey,
    onSuccessMessage: (message) =>
      message || "Leave request deleted successfully",
    onClose: () => setShowDialog(false),
  });
  const handleEdit = (item) => {
    setShowDialog(true);
    setInitialValues(item);
  };
  const handelOpen = () => {
    setShowDialog(true);
    setInitialValues(null);
  };
  const id = useId();
  const { newData } = data || {};


  // Status is applied here rather than in the query: the server returns one
  // leave year, which is a handful of rows, and filtering them in the browser
  // keeps the tiles above honest — they always describe the whole year.
  const visibleLeave = useMemo(() => {
    if (!Array.isArray(newData)) return [];
    if (status === "All") return newData;
    return newData.filter((item) => item?.leaveStatus === status);
  }, [newData, status]);
  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <CardTitle>Leave Requests</CardTitle>
              <CardDescription>List of leave requests</CardDescription>
            </div>
            {/* map item.leaveData.map */}
            <div className="flex items-center gap-2">
              <Button size="icon" variant="outline" onClick={handelOpen}>
                <PlusIcon />
              </Button>
              <LeaveRequestNew
                showDialog={showDialog}
                setShowDialog={setShowDialog}
                initialValues={initialValues}
                setInitialValues={setInitialValues}
                newData={employeeCommonLeave}
              />
              {/* Shown whenever there are entitlements to show.
                  It used to be `newData?.length === 0` — the sheet appeared
                  only while the employee had *no* leave requests in the year,
                  and vanished the moment they booked any. That is backwards:
                  the allowance is most worth looking at once some of it has
                  been used. The name was guaranteed blank for the same reason,
                  being read from `newData[0]` in the one case where `newData`
                  is empty. */}
              {employeeCommonLeave?.leaveData?.length > 0 && (
                <LeaveSheet
                  item={{
                    ...employeeCommonLeave,
                    name:
                      employeeRecord?.name ||
                      newData?.[0]?.employee?.name ||
                      "this employee",
                  }}
                  queryKey={["commonLeave", searchParams, leaveYear]}
                />
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <LeaveCount slug={searchParams?.[0] ?? null} leaveYear={leaveYear} />
            <div className="border rounded-xl">
              <div className="sm:flex items-center justify-between border-b p-4 sm:space-y-0 space-y-2">
                <CardTitle className="text-indigo-600">
                  {status === "All" ? "Leave requests" : `${status} leave`}{" "}
                  {leaveYear} ({visibleLeave.length})
                </CardTitle>
                <div>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline">
                        <ListFilterIcon />
                        Filter
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-48 overflow-scroll">
                      <div className="space-y-4">
                        <Select value={status} onValueChange={setStatus}>
                          <SelectTrigger
                            id={`${id}-status`}
                            className="focus:ring-indigo-600"
                          >
                            <span>
                              Status: <SelectValue placeholder="All" />
                            </span>
                          </SelectTrigger>
                          <SelectContent>
                            {STATUSES.map((item) => (
                              <SelectItem key={item} value={item}>
                                {item}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Select value={leaveYear} onValueChange={setLeaveYear}>
                          <SelectTrigger
                            id={`${id}-year`}
                            className="focus:ring-indigo-600"
                          >
                            <span>
                              LeaveYear:{" "}
                              <SelectValue placeholder="Select a year" />
                            </span>
                          </SelectTrigger>
                          <SelectContent className="max-h-60 overflow-y-auto max-w-max">
                            {leaveYearOptions.map(
                              ({ value: option, isCurrent }) => (
                                <SelectItem
                                  key={option}
                                  value={option}
                                  className={isCurrent ? "font-semibold" : ""}
                                >
                                  {isCurrent ? `${option} (Current)` : option}
                                </SelectItem>
                              )
                            )}
                          </SelectContent>
                        </Select>
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
              </div>
              <div className="px-4 py-2">
                <ScrollArea
                  className={`${visibleLeave.length >= 2 ? "h-96" : ""}`}
                >
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {visibleLeave.map((data, index) => (
                      <LeaveRequestCard
                        key={data?._id || index}
                        data={data}
                        handleEdit={handleEdit}
                        handleDelete={deleteLeaveRequest}
                        queryKey={queryKey}
                      />
                    ))}
                  </div>
                  {/* An empty grid used to render as blank space, which reads
                      as a page that failed rather than a year with no leave
                      in it. */}
                  {visibleLeave.length === 0 && (
                    <p className="py-8 text-center text-sm text-muted-foreground">
                      {status === "All"
                        ? `No leave booked in ${leaveYear}.`
                        : `No ${status.toLowerCase()} leave in ${leaveYear}.`}
                    </p>
                  )}
                </ScrollArea>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </>
  );
};

const LeaveRequestCard = ({ data, handleEdit, handleDelete, queryKey }) => {
  return (
    <Card className="group">
      <CardHeader>
        <CardTitle>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">{data?.leaveType}</div>
            <Status title={data?.leaveStatus} />
          </div>
        </CardTitle>
        <CardDescription>
          <p className="text-sm">
            {format(data?.leaveStartDate, "PPP")} -{" "}
            {format(data?.leaveEndDate, "PPP")}
          </p>
        </CardDescription>
        <div className="flex items-center flex-wrap my-4 gap-x-3">
          <div className="flex gap-[6px] text-[13px] text-[#222222] font-normal items-center">
            <span>{data.leaveDays} Days</span>
          </div>
          <svg
            stroke="currentColor"
            fill="currentColor"
            strokeWidth="0"
            viewBox="0 0 512 512"
            className="text-gray-400"
            height="4"
            width="4"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path d="M256 8C119 8 8 119 8 256s111 248 248 248 248-111 248-248S393 8 256 8z"></path>
          </svg>
          <div className="flex gap-[6px] text-[13px] text-[#222222] font-normal items-center">
            <span>{data.leaveYear}</span>
          </div>
          <svg
            stroke="currentColor"
            fill="currentColor"
            strokeWidth="0"
            viewBox="0 0 512 512"
            className="text-gray-400"
            height="4"
            width="4"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path d="M256 8C119 8 8 119 8 256s111 248 248 248 248-111 248-248S393 8 256 8z"></path>
          </svg>
          <div className="flex gap-[6px] text-[13px] text-[#222222] font-normal items-center">
            <span>{format(data?.leaveSubmitDate, "PPP")}</span>
          </div>
        </div>
      </CardHeader>

      {["Approved", "Rejected", "Expired", "Cancelled", "Rolled Back"].includes(
        data?.leaveStatus,
      ) ? (
        <></>
      ) : isPast(data?.leaveStartDate) ? (
        <CardFooter>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="sm" variant="outline" className="text-red-500">
                <XIcon className="h-4 w-4x" />
                Expired
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle className={"text-blue-700 tracking-tight"}>
                  This action to mark the leave request as expired.
                </AlertDialogTitle>
                <AlertDialogDescription>
                  This action your leave balance will be updated accordingly.
                  The leave request will be marked as expired.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogAction
                  onClick={() =>
                    handleDelete({
                      leaveId: data?._id,
                      leaveStatus: "Expired",
                    })
                  }
                  className="bg-blue-700 hover:bg-blue-800"
                >
                  Continue
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardFooter>
      ) : (
        <CardFooter>
          <div className="flex items-center gap-2">
            <Button
              onClick={() => handleEdit(data)}
              size="sm"
              variant="outline"
              className="text-indigo-500"
            >
              <EditIcon className="h-4 w-4x" />
              Edit
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" variant="outline" className="text-red-500">
                  <XIcon className="h-4 w-4x" />
                  Cancel
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle className={"text-red-700"}>
                    Are you sure you want to cancel this leave request?
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    This action cannot be undone. If you proceed, the leave
                    request will be marked as rejected and you will not be able
                    to edit it again.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() =>
                      handleDelete({
                        leaveId: data?._id,
                        leaveStatus: "Cancelled",
                      })
                    }
                    className="bg-red-500 hover:bg-red-600"
                  >
                    Continue
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </CardFooter>
      )}
    </Card>
  );
};

export { EmployeeOtherDeatils, EmployeeLeaveDeatails };
