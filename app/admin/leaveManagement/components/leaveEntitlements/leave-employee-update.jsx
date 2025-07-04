"use client";
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
import { handleOfficeEmployee } from "@/server/officeServer/officeServer";
import { EditIcon } from "lucide-react";
import { useState } from "react";

export default function EmployeeUpdate({ item, queryKey }) {
  const [isOpen, setIsOpen] = useState(false);
  const field = [
    {
      name: "employeType",
      labelText: "Employe Type",
      type: "select",
      placeholder: "Select Employee Type",
      options: [
        { value: "Full-Time", label: "Full-Time" },
        { value: "Part-Time", label: "Part-Time" },
      ],
      validationOptions: {
        required: "Employe Type is required",
      },
    },
    {
      name: "dayPerWeek",
      labelText: "Days",
      type: "number",
      pattern: /d*/,
      inputMode: "numeric",
      step: 2,
      placeholder: "Enter Days",
      validationOptions: {
        required: "Days is required",
        pattern: {
          // we can't allow to decimal values with not allow zero start with one
          // value: /^[1-7]$/,
          value: /^(?:[1-6](?:\.5)?|7)$/,
          message: "Days should be between 1 and 7",
        },
      },
    },
  ];
  const { mutate: updateEmployee, isPending } = useSubmitMutation({
    invalidateKey: queryKey,
    mutationFn: async (data) => await handleOfficeEmployee(data.data, data.id),
    onSuccessMessage: () => " Employee updated successfully",
    onClose: () => setIsOpen(false),
  });

  const handleSubmit = (data, password, id) => {
    updateEmployee({ data: { ...data, password: password }, id });
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button size="icon" variant="outline">
          <EditIcon />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Update Employee Leave</DialogTitle>
          <DialogDescription>
            Please select the leave type and number of days.
          </DialogDescription>
        </DialogHeader>
        <GlobalForm
          fields={
            // in this one we have to check if the join date is not there we have to add the joinDate field other wise remove it
            item?.joinDate
              ? field
              : [
                  ...field,
                  {
                    name: "joinDate",
                    labelText: "Join Date",
                    type: "date",
                    value: new Date(),
                    placeholder: "Start Date",
                    validationOptions: {
                      required: "Join Date is required",
                    },
                  },
                ]
          }
          isLoading={isPending}
          onSubmit={(data) => handleSubmit(data, item.password, item?._id)}
        />
      </DialogContent>
    </Dialog>
  );
}
