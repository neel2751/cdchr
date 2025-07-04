"use client";
import { GlobalForm } from "@/components/form/form";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useSubmitMutation } from "@/hooks/use-mutate";
import { useFetchQuery, useFetchSelectQuery } from "@/hooks/use-query";
import {
  getEmployeeLeaveData,
  storeEmployeeLeave,
} from "@/server/leaveServer/leaveServer";
import { getSelectLeaveCategories } from "@/server/selectServer/selectServer";
import { differenceInDays, isBefore } from "date-fns";
import React from "react";
import { toast } from "sonner";

const LeaveRequestNew = ({
  showDialog,
  setShowDialog,
  initialValues,
  setInitialValues,
  children,
}) => {
  //   const [showDialog, setShowDialog] = React.useState(false);
  //   const [initialValues, setInitialValues] = React.useState(null);

  const { data: leaveTypes = [] } = useFetchSelectQuery({
    queryKey: ["leave-types"],
    fetchFn: getSelectLeaveCategories,
  });

  const { mutate: submitLeaveRequest } = useSubmitMutation({
    mutationFn: async (data) => storeEmployeeLeave(data, initialValues?._id),
    invalidateKey: ["leave-requests"],
    onSuccessMessage: () => "Leave request submitted successfully",
    onClose: () => {
      setShowDialog(false);
      setInitialValues(null);
    },
  });

  const handleClose = () => {
    setShowDialog(false);
    setInitialValues(null);
  };

  const { data } = useFetchQuery({
    queryKey: ["employee-leave-types"],
    fetchFn: getEmployeeLeaveData,
  });

  const { newData } = data || {};

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
    const totalCount = differenceInDays(leaveEndDate, leaveStartDate);

    const result = newData?.leaveData.find(
      (item) => item.leaveType === leaveType
    );
    // change the logic after test finish... add the ! on the isPast
    if (!isPast(new Date(result?.eligibleDate)))
      return toast.warning("You are not eligible for this leave type"); // ✅ Task6
    if (!initialValues?._id) {
      if (result?.total < totalCount)
        return toast.warning(
          `${leaveType} is only available for ${result?.total} days`
        );
      if (totalCount > result?.remaining)
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
    <>
      {children}
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        {/* <DialogTrigger asChild>{children}</DialogTrigger> */}
        <DialogContent className="max-w-xl h-auto">
          <DialogHeader>
            <DialogTitle>Leave Request</DialogTitle>
            <DialogDescription>
              Please fill in the form below to submit a leave request.
            </DialogDescription>
          </DialogHeader>
          <GlobalForm
            fields={fields}
            onSubmit={handleSubmit}
            initialValues={initialValues}
          />
        </DialogContent>
      </Dialog>
    </>
  );
};

export default LeaveRequestNew;
