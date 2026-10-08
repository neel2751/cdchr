import { useBankHolidayRule } from "@/lib/holiday";
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
import { isAfter } from "date-fns";
import { toast } from "sonner";
import { useSubmitMutation } from "@/hooks/use-mutate";
import { adminEmployeeLeaveRequest } from "@/server/leaveServer/leaveEmployeeServer";
import {
  sickNoteField,
  useSickNoteUpload,
} from "../leaveRequest/sick-note-field";

export const AddEmploeeLeave = () => {
  const { isClosedDay } = useBankHolidayRule();
  const [showDialog, setShowDialog] = useState(false);

  // Memoised: GlobalForm resets whenever `initialValues` changes identity, so a
  // fresh object each render would reset the form on every keystroke.
  const defaultValues = React.useMemo(
    () => ({ leaveSubmitDate: new Date() }),
    []
  );

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
    {
      name: "halfDayType",
      labelText: "Half Day Type",
      type: "select",
      showIf: {
        field: "leaveType",
        value: "Half Day",
      },
      options: [
        { label: "First Half", value: "First Half" },
        { label: "Second Half", value: "Second Half" },
      ],
      size: true,
      validationOptions: {
        required: "Please select a half day type",
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
      // See leave-request-new.jsx: not offered when the company closes on bank
      // holidays, and enforced again server-side.
      disabled: (date) => isClosedDay(date),
    },
    // Recording an old absence needs the date it was actually raised.
    // Left at today it stamps a historical record with today's date, which
    // reads as leave requested after it had already been taken.
    {
      name: "leaveSubmitDate",
      labelText: "Submit Date",
      type: "date",
      placeholder: "Select Submit Date",
      size: true,
      validationOptions: {
        required: "Submit date is required",
        validate: (value, formValues) => {
          if (!value) return true;
          if (isAfter(new Date(value), new Date())) {
            return "Submit date cannot be in the future";
          }
          const firstLeaveDate = [...(formValues?.leaveDates || [])]
            .map((date) => new Date(date))
            .sort((a, b) => a - b)[0];
          if (firstLeaveDate && isAfter(new Date(value), firstLeaveDate)) {
            return "Submit date should be on or before the first day of leave";
          }
          return true;
        },
      },
      disabled: (date) => isAfter(date, new Date()),
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

  const { mutate: submitLeaveRequest } = useSubmitMutation({
    mutationFn: async (data) => await adminEmployeeLeaveRequest(data),
    // Rendered inside LeaveContainer, above the same request table.
    // "admin-leave-requests" is not a key anything queries.
    invalidateKey: ["employee-leave-request"],
    onSuccessMessage: () => "Leave request submitted successfully",
    onClose: () => setShowDialog(false),
  });

  const { prepareSickNote } = useSickNoteUpload();

  const handleSubmit = async (data) => {
    // An admin booking sick leave for someone else is held to the same sick
    // note rule as the employee booking it themselves.
    const noteResult = await prepareSickNote(data);
    if (!noteResult.success) {
      return toast.warning(noteResult.message);
    }

    submitLeaveRequest({ ...data, sickNote: noteResult.sickNote });
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
        initialValues={defaultValues}
        handleSubmit={handleSubmit}
        stickyFooter
      />
    </>
  );
};
