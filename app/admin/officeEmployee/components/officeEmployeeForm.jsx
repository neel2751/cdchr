import { GlobalForm } from "@/components/form/form";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import React from "react";

const OfficeEmployeeForm = ({
  showDialog,
  setShowDialog,
  fields,
  handleSubmit,
  initialValues,
  isEdit,
  isPending,
}) => {
  return (
    <Dialog open={showDialog} onOpenChange={setShowDialog}>
      <DialogContent className="w-full max-w-2xl max-h-screen overflow-y-auto bg-white rounded-lg shadow-lg p-6 sm:max-w-md md:max-w-lg lg:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Edit Office Employee" : "Add New Office Employee"}
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? " Update the details below to edit the office employee."
              : " Please fill in the form below to add a new office employee."}
          </DialogDescription>
        </DialogHeader>
        <GlobalForm
          fields={fields}
          onSubmit={handleSubmit}
          initialValues={initialValues}
          btnName={isEdit ? "Update Employee" : "Add Employee"}
          isLoading={isPending}
        />
      </DialogContent>
    </Dialog>
  );
};

export default OfficeEmployeeForm;
