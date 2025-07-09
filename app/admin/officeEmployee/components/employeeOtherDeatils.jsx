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

import LeaveRequestStatus from "../../leaveManagement/components/leaveRequest/request-status";
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
    params: { searchParams, leaveYear: getYear(new Date()) },
    fetchFn: employeeLeaveDetailsNew,
    queryKey,
    enabled: !!searchParams,
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
  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <CardTitle>Leave Requests</CardTitle>
              <CardDescription>List of leave requests</CardDescription>
            </div>
            <LeaveRequestNew
              showDialog={showDialog}
              setShowDialog={setShowDialog}
              initialValues={initialValues}
              setInitialValues={setInitialValues}
            >
              <Button size="icon" variant="outline" onClick={handelOpen}>
                <PlusIcon />
              </Button>
            </LeaveRequestNew>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <LeaveCount />
            <div className="border rounded-xl">
              <div className="flex items-center justify-between border-b p-4">
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
                    <PopoverContent className="w-48">
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
                          <SelectContent>
                            {/* show last 5 years */}
                            {Array.from({ length: 5 }, (_, k) => k).map(
                              (year) => (
                                <SelectItem
                                  key={getYear(new Date()) - year}
                                  value={(
                                    getYear(new Date()) - year
                                  ).toString()}
                                >
                                  {getYear(new Date()) - year}
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
                <ScrollArea className={`${newData?.length >= 2 ? "h-96" : ""}`}>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {newData &&
                      newData.map((data, index) => (
                        <LeaveRequestCard
                          key={index}
                          data={data}
                          handleEdit={handleEdit}
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

const LeaveRequestCard = ({ data, handleEdit, queryKey }) => {
  return (
    <Card className="group">
      <CardHeader>
        <CardTitle>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">{data?.leaveType}</div>
            <Status
              title={
                isPast(data?.leaveStartDate) ? "Rejected" : data?.leaveStatus
              }
            />
          </div>
        </CardTitle>
        <CardDescription>
          <p className="text-sm">
            {format(data?.leaveStartDate, "PPP")} -{" "}
            {format(data?.leaveEndDate, "PPP")}
          </p>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-muted-foreground mt-2">
          Requested on {format(data.leaveSubmitDate, "PPP")}
        </p>
      </CardContent>

      {data?.leaveStatus === "Approved" || data?.leaveStatus === "Rejected" ? (
        <></>
      ) : isPast(data?.leaveStartDate) ? (
        <CardFooter className="border-b">
          <LeaveRequestStatus
            leaveId={data?._id}
            invalidateKey={queryKey}
            leaveDate={data?.leaveStartDate}
          />
          {/* <Button size="sm" variant="outline" className="text-red-500">
            <XIcon className="h-4 w-4x" />
            Cancel
          </Button> */}
        </CardFooter>
      ) : (
        <CardFooter>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" className="text-indigo-500">
              <EditIcon className="h-4 w-4x" />
              Edit
            </Button>
            <Button size="sm" variant="outline" className="text-red-500">
              <XIcon className="h-4 w-4x" />
              Cancel
            </Button>
          </div>
        </CardFooter>
      )}
    </Card>
  );
};

export { EmployeeOtherDeatils, EmployeeLeaveDeatails };
