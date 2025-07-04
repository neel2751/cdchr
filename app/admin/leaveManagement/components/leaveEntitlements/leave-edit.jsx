import { Button } from "@/components/ui/button";
import { useSubmitMutation } from "@/hooks/use-mutate";
import { EditIcon, SaveIcon, XIcon } from "lucide-react";
import React from "react";
import { toast } from "sonner";

export default function LeaveEdit({
  initialValues,
  entitlement,
  item,
  onEdit,
  queryKey,
  setValue,
  setInitialValues,
}) {
  const { mutate: updateLeave, isPending } = useSubmitMutation({
    mutationFn: async (newValue) =>
      await editCommonLeave({ value: newValue, initialValues }),
    invalidateKey: queryKey,
    onSuccessMessage: (message) => message,
    onClose: () => {
      setValue(null);
      setInitialValues(null); // reset state
    },
  });
  async function onSubmit() {
    if (value % 1 !== 0) return toast.warning("No decimal values allowed");
    if (value < initialValues?.used)
      return toast.warning("New total cannot be less than used days");
    const newValue = parseInt(Number(value));
    if (newValue < 0) return toast.error(" Invalid nunber of days");
    // TODO: Update the leave balance
    if (newValue === initialValues?.total)
      return toast.error("No change in leave balance");
    updateLeave(newValue);
  }
  return (
    <>
      {initialValues?.leaveType === entitlement?.leaveType ? (
        <div className="space-x-2">
          <Button
            size="icon"
            variant="outline"
            onClick={onSubmit}
            disabled={isPending}
          >
            <SaveIcon />
          </Button>
          <Button
            size="icon"
            variant="outline"
            onClick={() => {
              setValue(null);
              setInitialValues(null); // reset state
            }}
            disabled={isPending}
          >
            <XIcon />
          </Button>
        </div>
      ) : (
        <Button
          size="icon"
          variant="outline"
          onClick={() => onEdit(entitlement, item)}
          disabled={
            isPending ||
            entitlement?.leaveType === "Maternity Leave" ||
            entitlement?.leaveType === "Paternity Leave" ||
            entitlement?.leaveType === "Sick Leave"
          }
        >
          <EditIcon />
        </Button>
      )}
    </>
  );
}
