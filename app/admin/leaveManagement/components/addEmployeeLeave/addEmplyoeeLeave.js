import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useFetchSelectQuery } from "@/hooks/use-query";
import {
  getSelectLeaveCategories,
  getSelectOfficeEmployee,
} from "@/server/selectServer/selectServer";
import React, { useState } from "react";
import LeaveForm from "../leaveRequest/leave-form";
import { AddLeaveRequest } from "../leaveRequest/request";
import { isBefore } from "date-fns";
import { toast } from "sonner";
import { useSubmitMutation } from "@/hooks/use-mutate";
import { adminEmployeeLeaveRequest } from "@/server/leaveServer/leaveEmployeeServer";

export const AddEmploeeLeave = () => {
  const [showDialog, setShowDialog] = useState(false);

  const { data: leaveTypes = [] } = useFetchSelectQuery({
    queryKey: ["admin-leave-types"],
    fetchFn: getSelectLeaveCategories, // old select query
  });

  const { data: officeEmployee = [] } = useFetchSelectQuery({
    queryKey: ["admin-leave-employee"],
    fetchFn: getSelectOfficeEmployee,
  });

  const fields = [
    {
      name: "employeeId",
      labelText: "Employee Name",
      type: "select",
      options: officeEmployee,
      size: true,
      validationOptions: {
        required: "Please select a Employee",
      },
    },
    {
      name: "leaveType",
      labelText: "Leave Type",
      type: "select",
      options: leaveTypes,
      size: true,
      validationOptions: {
        required: "Please select a leave type",
      },
    },
    // {
    //   name: "leaveStartDate",
    //   labelText: "Start Date",
    //   type: "date",
    //   placeholder: "Select Start Date",
    //   validationOptions: {
    //     required: "Start Date is required",
    //     // don't select dates before today
    //     validate: (value) => {
    //       if (value) {
    //         return isBefore(value, new Date())
    //           ? "Start Date cannot be before today"
    //           : true;
    //       }
    //       return true;
    //     },
    //   },
    //   disabled: (date) => isBefore(date, new Date()),
    // },
    // {
    //   name: "leaveEndDate",
    //   labelText: "End Date",
    //   type: "date",
    //   hideIf: {
    //     field: "leaveType",
    //     value: "Half Day",
    //   },
    //   placeholder: "Select End Date",
    //   validationOptions: {
    //     required: "End Date is required",
    //     // don't select dates before today
    //     validate: (value) => {
    //       if (value) {
    //         return isBefore(value, new Date())
    //           ? "End Date cannot be before today"
    //           : true;
    //       }
    //       return true;
    //     },
    //   },
    //   disabled: (date) => isBefore(date, new Date()),
    // },
    {
      name: "leaveDates",
      labelText: "Date Range",
      type: "multidate",
      placeholder: "Select Date Range",
      validationOptions: {
        required: "Date Range is required",
        validate: (value) => {
          if (!value || value.length === 0) {
            return "Please select at least one date";
          }
          return true;
        },
      },
    },
    {
      name: "leaveReason",
      labelText: "Reason (optional)",
      type: "textarea",
      placeholder: "Enter Reason",
      size: true,
    },
  ];

  const { mutate: submitLeaveRequest } = useSubmitMutation({
    mutationFn: async (data) => await adminEmployeeLeaveRequest(data),
    invalidateKey: ["admin-leave-requests"],
    onSuccessMessage: () => "Leave request submitted successfully",
    onClose: () => setShowDialog(false),
  });

  const handleSubmit = (data) => {
    const { leaveStartDate, leaveEndDate, leaveType } = data;
    const isBeforeEndDate = isBefore(
      new Date(leaveEndDate),
      new Date(leaveStartDate)
    );
    if (isBeforeEndDate) {
      toast.warning("End date should be after start date");
      return;
    }
    submitLeaveRequest(data);
  };

  return (
    <>
      <AddLeaveRequest
        onAdd={() => setShowDialog(true)}
        title={"Add Employee Leave"}
      />
      <LeaveForm
        showDialog={showDialog}
        setShowDialog={() => setShowDialog(false)}
        fields={fields}
        handleSubmit={handleSubmit}
      />
    </>
  );
};
