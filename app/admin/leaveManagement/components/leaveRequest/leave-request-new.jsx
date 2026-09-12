"use client";
import { GlobalForm } from "@/components/form/form";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useSubmitMutation } from "@/hooks/use-mutate";
import { useFetchQuery, useFetchSelectQuery } from "@/hooks/use-query";
import { storeEmployeeLeaveData } from "@/server/leaveServer/leaveRequestServer";
import { getEmployeeLeaveData } from "@/server/leaveServer/leaveServer";
import { getSelectLeaveRequestForEmployee } from "@/server/selectServer/selectServer";
import { isBefore } from "date-fns";
import React from "react";
import { toast } from "sonner";
import { sickNoteField, useSickNoteUpload } from "./sick-note-field";

const LeaveRequestNew = ({
  showDialog,
  setShowDialog,
  initialValues,
  setInitialValues,
  newData,
}) => {
  //   const [showDialog, setShowDialog] = React.useState(false);
  //   const [initialValues, setInitialValues] = React.useState(null);

  const { data: leaveTypes = [] } = useFetchSelectQuery({
    queryKey: ["leave-types"],
    fetchFn: getSelectLeaveRequestForEmployee,
  });

  const { mutate: submitLeaveRequest } = useSubmitMutation({
    mutationFn: async (data) =>
      storeEmployeeLeaveData(data, initialValues?._id),
    invalidateKey: ["leave-requests"],
    onSuccessMessage: () => "Leave request submitted successfully",
    onClose: () => {
      setShowDialog(false);
      setInitialValues(null);
    },
  });

  const { prepareSickNote } = useSickNoteUpload();

  const handleSubmit = async (data) => {
    // ✅ Task1 : Implement the logic to submit the leave request
    // ✅ Task2 : Check the validation like Start Date, End Date
    // ✅ Task3 : Check if End date is before Start date
    // ✅ Task4 : Check if the leave type is selected
    // ✅ Task5 : Count the number of days between the start and end dates
    // ✅ Task6 : Check if the employee has enough leave balance
    // ✅ Task7 : Submit the leave request
    const { leaveType, leaveDates } = data;

    // Sick note first: nothing is submitted until a long sick absence has one.
    const noteResult = await prepareSickNote(data);
    if (!noteResult.success) {
      return toast.warning(noteResult.message);
    }

    const totalCount = leaveDates?.length || 0;
    const payload = { ...data, sickNote: noteResult.sickNote, totalCount };

    const result = newData?.leaveData?.find(
      (item) => item.leaveType === leaveType
    );
    if (!initialValues?._id) {
      if (result?.total < totalCount)
        return toast.warning(
          `${leaveType} is only available for ${result?.total} days`
        );
      if (totalCount > result?.remaining)
        return toast.warning(
          `You have only ${result?.remaining} days left for ${leaveType}`
        );
      submitLeaveRequest(payload);
    } else {
      submitLeaveRequest(payload);
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
    // Leave is booked as a list of individual days — the same shape the server
    // stores and the admin form sends. A start/end pair was dropped on the way
    // in, so a request made here never reached the balance engine.
    {
      name: "leaveDates",
      labelText: "Leave Dates",
      type: "multidate",
      placeholder: "Select Dates",
      validationOptions: {
        required: "Please select at least one date",
        validate: (value) =>
          (value && value.length > 0) || "Please select at least one date",
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
    sickNoteField,
  ];

  return (
    <>
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        {/* <DialogTrigger asChild>{children}</DialogTrigger> */}
        {/* Same column layout as the admin form: the header and its close
            button stay put, only the fields scroll. */}
        <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 p-0 sm:max-w-xl">
          <DialogHeader className="shrink-0 gap-2 border-b p-6 pr-12">
            <DialogTitle>Leave Request</DialogTitle>
            <DialogDescription>
              Please fill in the form below to submit a leave request.
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto p-6">
            <GlobalForm
              fields={fields}
              onSubmit={handleSubmit}
              initialValues={initialValues}
              // Pinned to the bottom like the admin forms. The negative margins
              // bleed the bar through this container's p-6 so it spans the full
              // dialog width.
              footerClassName="sticky bottom-0 z-10 -mx-6 -mb-6 mt-7 border-t bg-background px-6 py-4"
            />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default LeaveRequestNew;
