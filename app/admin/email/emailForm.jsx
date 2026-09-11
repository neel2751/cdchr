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
          {/* Was "Edit / New Leave Request" — copy-pasted from the leave form
              and never changed, on the dialog for adding an SMTP sender. */}
          <DialogTitle>
            {isEdit ? "Edit email account" : "Add email account"}
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Update the SMTP details this company sends email through."
              : "Add an SMTP sender for this company to send email through."}
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
