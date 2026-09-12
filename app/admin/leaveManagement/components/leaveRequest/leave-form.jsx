import { GlobalForm } from "@/components/form/form";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import React from "react";

/**
 * The leave request dialog, shared by the employee form, the admin's own
 * request and the admin-for-employee form.
 *
 * It is deliberately laid out as a column rather than left to grow: with a leave
 * type, dates, a submit date, a reason and a sick note dropzone the form runs
 * taller than a laptop viewport. Grown unchecked it overflowed the screen in
 * both directions — the submit button was unreachable and the close button sat
 * above the top edge. The header (and therefore the close button) stays put
 * while only the fields scroll.
 */
const LeaveForm = ({
  showDialog,
  setShowDialog,
  fields,
  handleSubmit,
  initialValues,
  isEdit,
  // Pins the submit button to the bottom of the scrolling body. Opt-in: the
  // longest form (an admin recording leave for an employee) otherwise pushes it
  // below the fold, where it reads as missing.
  stickyFooter = false,
}) => {
  return (
    <Dialog open={showDialog} onOpenChange={setShowDialog}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 p-0 sm:max-w-xl">
        {/* pr-12 keeps the title clear of the close button */}
        <DialogHeader className="shrink-0 gap-2 border-b p-6 pr-12">
          <DialogTitle>
            {isEdit ? "Edit Leave Request" : "New Leave Request"}
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Update the details below to edit the leave request."
              : "Please fill in the form below to submit a leave request."}
          </DialogDescription>
        </DialogHeader>
        {/* min-h-0 lets this shrink inside the flex column so it, rather than
            the dialog, is what scrolls. */}
        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          <GlobalForm
            fields={fields}
            onSubmit={handleSubmit}
            initialValues={initialValues}
            // The negative margins bleed the bar through this container's p-6
            // so it spans the full dialog width and sits flush at the bottom.
            footerClassName={
              stickyFooter
                ? "sticky bottom-0 z-10 -mx-6 -mb-6 mt-7 border-t bg-background px-6 py-4"
                : undefined
            }
          />
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default LeaveForm;
