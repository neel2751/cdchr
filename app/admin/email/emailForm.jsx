import { GlobalForm } from "@/components/form/form";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import React from "react";

const EmailForm = ({
  showDialog,
  setShowDialog,
  fields,
  handleSubmit,
  initialValues,
  isEdit,
}) => {
  return (
    <Dialog open={showDialog} onOpenChange={setShowDialog}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Edit Leave Request" : "New Leave Request"}
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Update the details below to edit the leave request."
              : "Please fill in the form below to submit a leave request."}
          </DialogDescription>
        </DialogHeader>
        <GlobalForm
          fields={fields}
          onSubmit={handleSubmit}
          initialValues={initialValues}
        />
      </DialogContent>
    </Dialog>
  );
};

export default EmailForm;
