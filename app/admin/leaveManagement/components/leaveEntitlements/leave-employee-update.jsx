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
    // No carry-forward field here any more.
    //
    // An exception is per leave type now, and a single select cannot say "never
    // carry annual leave but always carry the company sick days". Rather than
    // put a dynamic per-type editor inside this small dialog, exceptions are set
    // in one place — Leave → Settings → Individual exceptions — and shown
    // read-only against each leave type on the entitlement sheet.
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

  // `password` is deliberately NOT sent.
  //
  // This used to pass `item.password` through, but the entitlement table stopped
  // projecting the password hash (rightly — it has no business reaching the
  // browser), so the value was `undefined`. handleOfficeEmployee Object.assigns
  // the payload onto the document, and assigning undefined to a required path
  // unsets it: the save then failed validation and the button answered
  // "Something went wrong on Office Employee" every time. Omitting the key
  // entirely leaves the stored hash alone, which is what was always meant.
  const handleSubmit = (data, id) => {
    updateEmployee({ data, id });
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
          // Seeded from the row. Without this the dialog opened blank, so
          // changing one field meant re-entering the others — and with a
          // carry-forward setting on it, saving would quietly reset that too.
          initialValues={{
            employeType: item?.employeType || "",
            dayPerWeek: item?.dayPerWeek ?? "",
            ...(item?.joinDate ? {} : { joinDate: new Date() }),
          }}
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
          onSubmit={(data) => handleSubmit(data, item?._id)}
        />
      </DialogContent>
    </Dialog>
  );
}
