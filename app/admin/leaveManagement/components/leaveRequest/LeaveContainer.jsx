"use client";
import React, { useState } from "react";
import LeaveForm from "./leave-form";
import { useFetchSelectQuery } from "@/hooks/use-query";
import { getSelectLeaveRequestForEmployee } from "@/server/selectServer/selectServer";
import { differenceInDays, isBefore } from "date-fns";
import { LeaveRequestTableNew } from "./request-table";
import { toast } from "sonner";
import { AddLeaveRequest } from "./request";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useSubmitMutation } from "@/hooks/use-mutate";
import { storeEmployeeLeaveData } from "@/server/leaveServer/leaveRequestServer";

export default function LeaveContainer() {
  const [showDialog, setShowDialog] = useState(false);
  const [isEdit, setIsEdit] = useState(false);
  const [initialValues, setInitialValues] = useState(null);

  const handleClose = () => {
    setInitialValues(null);
    setIsEdit(false);
    setShowDialog(false);
    setIsEdit(false);
  };

  const { mutate: submitLeaveRequest } = useSubmitMutation({
    mutationFn: async (data) =>
      storeEmployeeLeaveData(data, initialValues?._id),
    invalidateKey: ["leave-requests"],
    onSuccessMessage: () => "Leave request submitted successfully",
    onClose: () => handleClose(),
  });

  const handleAdd = () => {
    setInitialValues(null);
    setIsEdit(false);
    setShowDialog(true);
  };
  const handleEdit = (item) => {
    setInitialValues(item);
    setIsEdit(true);
    setShowDialog(true);
  };

  const { data: leaveTypes = [] } = useFetchSelectQuery({
    queryKey: ["leave-types"],
    fetchFn: getSelectLeaveRequestForEmployee,
  });

  const handleSubmit = (data) => {
    // ✅ Task1 : Implement the logic to submit the leave request
    // ✅ Task2 : Check the validation like Start Date, End Date
    // ✅ Task3 : Check if End date is before Start date
    // ✅ Task4 : Check if the leave type is selected
    // ✅ Task5 : Count the number of days between the start and end dates
    // ✅ Task6 : Check if the employee has enough leave balance
    // ✅ Task7 : Submit the leave request
    const { leaveStartDate, leaveEndDate, leaveType } = data;
    const isBeforeEndDate = isBefore(
      new Date(leaveEndDate),
      new Date(leaveStartDate)
    );
    if (isBeforeEndDate) {
      toast.warning("End date should be after start date");
      return;
    }
    const totalCount = differenceInDays(leaveEndDate, leaveStartDate) + 1;

    const result = leaveTypes.find((item) => item.label === leaveType);
    if (!initialValues?._id) {
      if (result?.total < totalCount)
        return toast.warning(
          `${leaveType} is only available for ${result?.total} days`
        );
      if (
        (!leaveType === "Annual Leave" || !leaveType === "Unpaid Leave") &&
        totalCount > result?.remaining
      )
        return toast.warning(
          `You have only ${result?.remaining} days left for ${leaveType}`
        );
      submitLeaveRequest({ ...data, totalCount });
    } else {
      submitLeaveRequest({ ...data, totalCount });
    }
  };

  const fields = [
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
    {
      name: "leaveStartDate",
      labelText: "Start Date",
      type: "date",
      placeholder: "Select Start Date",
      validationOptions: {
        required: "Start Date is required",
        // don't select dates before today
        validate: (value) => {
          if (value) {
            return isBefore(value, new Date())
              ? "Start Date cannot be before today"
              : true;
          }
          return true;
        },
      },
      disabled: (date) => isBefore(date, new Date()),
    },
    {
      name: "leaveEndDate",
      labelText: "End Date",
      type: "date",
      placeholder: "Select End Date",
      hideIf: {
        field: "leaveType",
        value: "Half Day",
      },
      validationOptions: {
        required: "End Date is required",
        // don't select dates before today
        validate: (value) => {
          if (value) {
            return isBefore(value, new Date())
              ? "End Date cannot be before today"
              : true;
          }
          return true;
        },
      },
      disabled: (date) => isBefore(date, new Date()),
    },
    {
      name: "leaveReason",
      labelText: "Reason (optional)",
      type: "textarea",
      placeholder: "Enter Reason",
      size: true,
    },
  ];

  return (
    <div className="mt-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <CardTitle>Leave Requests</CardTitle>
              <CardDescription>List of leave requests</CardDescription>
            </div>
            <AddLeaveRequest onAdd={handleAdd} />
          </div>
        </CardHeader>
        <CardContent>
          <LeaveRequestTableNew onEdit={handleEdit} />
        </CardContent>
      </Card>
      <LeaveForm
        showDialog={showDialog}
        setShowDialog={handleClose}
        fields={fields}
        initialValues={initialValues}
        handleSubmit={handleSubmit}
        isEdit={isEdit}
      />
    </div>
  );
}
