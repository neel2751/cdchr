import { GlobalForm } from "@/components/form/form";
import { CardTitle } from "@/components/ui/card";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { useSubmitMutation } from "@/hooks/use-mutate";
import { handleEmployeeLeaveStatus } from "@/server/leaveServer/getLeaveServer";
import { CircleCheckIcon, CircleXIcon } from "lucide-react";
import React from "react";

export default function LeaveRequestStatus({
  invalidateKey,
  leaveId,
  allowAccept,
  allowReject,
}) {
  const [open, setOpen] = React.useState(false);
  const { mutate: handleSubmit } = useSubmitMutation({
    invalidateKey,
    mutationFn: async (data) =>
      handleEmployeeLeaveStatus({ leaveId: leaveId, ...data }),
    onSuccessMessage: (message) => message,
    onClose: () => setOpen(false),
  });
  return (
    <div className="flex items-center gap-3 ml-2">
      {allowAccept && (
        <Dialog
          status="Approved"
          onSubmit={handleSubmit}
          open={open}
          setOpen={setOpen}
        >
          <CircleCheckIcon className="w-5 h-5 text-green-600 cursor-pointer" />
        </Dialog>
      )}
      {allowReject && (
        <Dialog status="Rejected" onSubmit={handleSubmit}>
          <CircleXIcon className="w-5 h-5 text-red-600 cursor-pointer" />
        </Dialog>
      )}
    </div>
  );
}
const commonField = [
  {
    name: "adminComment",
    labelText: "Comment",
    size: true,
    type: "textarea",
    placeholder: "Enter your comment",
  },
];
const Dialog = ({ status, onSubmit, children, open, setOpen }) => (
  <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild>{children}</PopoverTrigger>
    <PopoverContent>
      <div className="space-y-4">
        <CardTitle
          className={`text-sm ${
            status === "Approved" ? "text-green-700" : "text-rose-600"
          }`}
        >
          Leave Request {status}
        </CardTitle>
        <GlobalForm
          fields={commonField}
          btnName={status === "Approved" ? "Approve" : "Reject"}
          onSubmit={(data) => onSubmit({ ...data, leaveStatus: status })}
        />
      </div>
    </PopoverContent>
  </Popover>
);
