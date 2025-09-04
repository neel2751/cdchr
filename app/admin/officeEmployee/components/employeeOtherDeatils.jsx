import EmployeeOverview from "@/components/tabs/employee-overview";
// import LeaveRequests from "@/components/tabs/leave-requests";
import { useCommonContext } from "@/context/commonContext";
import { useFetchQuery } from "@/hooks/use-query";
import { employeeLeaveDetailsNew } from "@/server/officeServer/officeEmployeeDetails";
import React, { useId, useState } from "react";
import LeaveCount from "../../leaveManagement/components/leaveDashboard/leaveCount";
import { Button } from "@/components/ui/button";
import { EditIcon, ListFilterIcon, PlusIcon, XIcon } from "lucide-react";
import LeaveRequestNew from "../../leaveManagement/components/leaveRequest/leave-request-new";
import { format, getYear, isPast } from "date-fns";
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
import {
  getCurrentLeaveYearStart,
  getLeaveYearString,
  getLeaveYearStringFilter,
} from "@/lib/getLeaveYear";
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

const EmployeeOtherDeatils = () => {
  const { newData } = useAvatar();
  const updateData = [
    {
      title: "Bank Account Details",
      content: [
        { label: "Account Name", value: newData?.accountName || "-" },
        { label: "Account No", value: newData?.accountNo || "-" },
        { label: "Sort Code", value: newData?.sortCode || "-" },
      ],
    },
    {
      title: "Immigration Deatils",
      content: [
        { label: "Nationality", value: newData?.immigrationType || "-" },
        { label: "Visa Type", value: newData?.immigrationCategory || "-" },
        { label: "Employee Type", value: newData?.employeType || "-" },
        { label: "Employee NI", value: newData?.employeNI || "-" },
        newData?.immigrationType !== "British" && {
          label: "Visa Start Date",
          value: newData?.visaStartDate || "-",
        },
        newData?.immigrationType !== "British" && {
          label: "Visa End Date",
          value: newData?.visaEndDate || "-",
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

  return <EmployeeOverview data={updateData} />;
};

const EmployeeLeaveDeatails = () => {
  const { searchParams } = useCommonContext();
  const [showDialog, setShowDialog] = useState(false);
  const [initialValues, setInitialValues] = useState(null);
  const queryKey = ["leaveDeatils", searchParams];
  const { data } = useFetchQuery({
    params: { searchParams, leaveYear: getLeaveYearString(new Date()) },
    fetchFn: employeeLeaveDetailsNew,
    queryKey,
    enabled: !!searchParams,
  });

  const { data: commonLeave } = useFetchQuery({
    queryKey: ["commonLeave", searchParams],
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
  const currentLeaveYear = getCurrentLeaveYearStart();
  const years = [-1, 0, 1].map((offset) => currentLeaveYear + offset);
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
              {newData?.length === 0 && (
                <LeaveSheet
                  item={{
                    name: newData[0]?.employee.name,
                    ...employeeCommonLeave,
                  }}
                />
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <LeaveCount />
            <div className="border rounded-xl">
              <div className="sm:flex items-center justify-between border-b p-4 sm:space-y-0 space-y-2">
                <CardTitle className="text-indigo-600">
                  All Leave Request ({newData?.length})
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
                        <Select defaultValue={"All"}>
                          <SelectTrigger
                            id={id}
                            className="focus:ring-indigo-600"
                          >
                            <span>
                              Status:{" "}
                              <SelectValue placeholder="Select a year" />
                            </span>
                          </SelectTrigger>
                          <SelectContent>
                            {/* show last 5 years */}
                            {["All", "Approved", "Pending", "Rejected"].map(
                              (item) => (
                                <SelectItem key={item} value={item}>
                                  {item}
                                </SelectItem>
                              )
                            )}
                          </SelectContent>
                        </Select>
                        <Select defaultValue={getYear(new Date()).toString()}>
                          <SelectTrigger
                            id={id}
                            className="focus:ring-indigo-600"
                          >
                            <span>
                              LeaveYear:{" "}
                              <SelectValue placeholder="Select a year" />
                            </span>
                          </SelectTrigger>
                          <SelectContent className="max-h-60 overflow-y-auto max-w-max">
                            {years.map((year) => {
                              const leaveYear = getLeaveYearStringFilter(year);

                              const isCurrent = year === getYear(new Date());
                              if (isCurrent) {
                                return (
                                  <SelectItem
                                    key={leaveYear}
                                    value={leaveYear}
                                    className="font-semibold"
                                  >
                                    {leaveYear} (Current)
                                  </SelectItem>
                                );
                              }
                              return (
                                <SelectItem key={leaveYear} value={leaveYear}>
                                  {leaveYear}
                                </SelectItem>
                              );
                            })}
                          </SelectContent>
                        </Select>
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
              </div>
              <div className="px-4 py-2">
                <ScrollArea className={`${newData?.length >= 2 ? "h-96" : ""}`}>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {newData &&
                      newData.map((data, index) => (
                        <LeaveRequestCard
                          key={index}
                          data={data}
                          handleEdit={handleEdit}
                          handleDelete={deleteLeaveRequest}
                          queryKey={queryKey}
                        />
                      ))}
                    {/* <LeaveRequests /> */}
                  </div>
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

      {["Approved", "Rejected", "Expired", "Cancelled"].includes(
        data?.leaveStatus
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
