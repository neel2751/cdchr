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
import { useTerms } from "@/app/admin/providers";
import { PlusIcon } from "lucide-react";
import React from "react";

export default function AddSiteAssignment({ queryKey }) {
  const [open, setOpen] = React.useState(false);
  // The company's words: "Enrol Student" in a tuition centre. See
  // data/terminology.js.
  const { fill } = useTerms();
  const { data: sites = [] } = useFetchSelectQuery({
    queryKey: ["selectSiteProject"],
    fetchFn: getSelectProjects,
  });

  const { data: employees = [] } = useFetchSelectQuery({
    queryKey: ["selectEmployee"],
    fetchFn: getSelectEmployee,
  });

  const { mutate: assignEmployees, isPending } = useSubmitMutation({
    mutationFn: async (data) => await assignEmployeesToSite(data),
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
      name: "assignDate",
      labelText: "Select Date",
      type: "date",
      placeholder: "Select a date",
      validationOptions: {
        required: "Date is Required",
      },
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
              {fill("Choose the {site}, the date and who to assign.")}
            </DialogDescription>
          </DialogHeader>
          <GlobalForm
            fields={fields}
            onSubmit={assignEmployees}
            btnName={"Assign"}
            isLoading={isPending}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
