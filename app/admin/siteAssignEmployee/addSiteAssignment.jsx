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
import { PlusIcon } from "lucide-react";
import React from "react";

export default function AddSiteAssignment({ queryKey }) {
  const [open, setOpen] = React.useState(false);
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
      labelText: "Site Project",
      type: "select",
      options: sites,
      validationOptions: {
        required: "Site Project is Required",
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
      labelText: "Employee",
      type: "multipleSelect",
      options: employees,
      validationOptions: {
        required: "Select atleast one employee",
      },
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
        Assign Employee
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Assign Employee to Site</DialogTitle>
            <DialogDescription>
              Select the employee and assign them to the site.
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
