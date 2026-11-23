import { GlobalForm } from "@/components/form/form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useSubmitMutation } from "@/hooks/use-mutate";
import { useFetchSelectQuery } from "@/hooks/use-query";
import {
  getSelectEmployee,
  getSelectProjects,
} from "@/server/selectServer/selectServer";
import { assignEmployeesToSite } from "@/server/siteAssignmentServer/siteAssignmentServer";
import { assignOngoing } from "@/server/siteAssignmentServer/standingAssignmentServer";
import { useBranding, useTerms } from "@/app/admin/providers";
import { PlusIcon } from "lucide-react";
import React from "react";

export default function AddSiteAssignment({ queryKey }) {
  const [open, setOpen] = React.useState(false);
  // The company's words: "Enrol Student" in a tuition centre. See
  // data/terminology.js.
  const { fill } = useTerms();
  // Day by day (a builder) or from a date until further notice (a tuition
  // centre enrolling for the year) — the company's industry decides which
  // the dialog starts on; either can be chosen. See lib/roster.js.
  const assignmentStyle = useBranding()?.assignmentStyle || "day";
  const initialValues = React.useMemo(
    () => ({ mode: assignmentStyle }),
    [assignmentStyle],
  );
  const { data: sites = [] } = useFetchSelectQuery({
    queryKey: ["selectSiteProject"],
    fetchFn: getSelectProjects,
  });

  const { data: employees = [] } = useFetchSelectQuery({
    queryKey: ["selectEmployee"],
    fetchFn: getSelectEmployee,
  });

  const { mutate: assignEmployees, isPending } = useSubmitMutation({
    mutationFn: async (data) =>
      data?.mode === "ongoing"
        ? await assignOngoing(data)
        : await assignEmployeesToSite(data),
    onSuccessMessage: (message) => message || "Assign Employee Successfully",
    invalidateKey: queryKey || ["siteAssignment"],
    onClose: () => {
      setOpen(false);
    },
  });

  const fields = [
    {
      name: "siteId",
      labelText: fill("{Site}"),
      type: "select",
      options: sites,
      validationOptions: {
        required: fill("{Site} is required"),
      },
    },
    {
      name: "mode",
      labelText: "How long",
      type: "select",
      options: [
        { value: "day", label: "Just this day" },
        { value: "ongoing", label: "From a date, ongoing" },
      ],
      validationOptions: { required: "Choose how long" },
    },
    {
      name: "assignDate",
      labelText: "Select Date",
      type: "date",
      placeholder: "Select a date",
      showIf: { field: "mode", value: "day" },
      validationOptions: {
        required: "Date is Required",
      },
    },
    {
      name: "startDate",
      labelText: "From",
      type: "date",
      placeholder: "First day",
      showIf: { field: "mode", value: "ongoing" },
      validationOptions: { required: "Choose the first day" },
    },
    {
      name: "endDate",
      labelText: "Until (optional)",
      type: "date",
      placeholder: "Last day",
      helperText: "*Leave empty for until further notice.",
      showIf: { field: "mode", value: "ongoing" },
    },
    {
      name: "days",
      labelText: "On these days (optional)",
      type: "multipleSelect",
      helperText: "*Leave empty for every day.",
      showIf: { field: "mode", value: "ongoing" },
      options: [
        { value: "1", label: "Monday" },
        { value: "2", label: "Tuesday" },
        { value: "3", label: "Wednesday" },
        { value: "4", label: "Thursday" },
        { value: "5", label: "Friday" },
        { value: "6", label: "Saturday" },
        { value: "0", label: "Sunday" },
      ],
    },
    {
      name: "employee",
      labelText: fill("{SiteEmployees}"),
      type: "multipleSelect",
      options: employees,
      validationOptions: {
        required: fill("Select at least one {siteEmployee}"),
      },
    },
    {
      name: "moveExisting",
      labelText: fill(
        "If they are already assigned on the same date, move them to this {site}",
      ),
      type: "checkbox",
      showIf: { field: "mode", value: "day" },
    },
  ];

  return (
    <>
      <Button
        size={"sm"}
        onClick={() => setOpen(true)}
        className={"cursor-pointer"}
      >
        <PlusIcon />
        {fill("Assign to {site}")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{fill("Assign {SiteEmployees} to a {Site}")}</DialogTitle>
            <DialogDescription>
              {fill(
                "Choose the {site}, who to assign, and for one day or from a date onwards.",
              )}
            </DialogDescription>
          </DialogHeader>
          <GlobalForm
            fields={fields}
            initialValues={initialValues}
            onSubmit={assignEmployees}
            btnName={"Assign"}
            isLoading={isPending}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
