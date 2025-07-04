import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useSubmitMutation } from "@/hooks/use-mutate";
import { deleteOneCommonLeaveToOneEmployee } from "@/server/leaveServer/entitlementServer";
import { Trash2 } from "lucide-react";

export default function LeaveDelete({
  leaveType,
  leaveYear,
  employeeId,
  queryKey,
}) {
  const { mutate: deleteLeave, isPending } = useSubmitMutation({
    mutationFn: async () =>
      await deleteOneCommonLeaveToOneEmployee({
        leaveType: leaveType,
        leaveYear: leaveYear,
        employeeId: employeeId,
      }),
    invalidateKey: queryKey,
    onSuccessMessage: () => "Leave Deleted successfully",
    onClose: () => {},
  });

  return (
    <>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            size="icon"
            variant="outline"
            className="hover:bg-red-100 hover:text-red-600 text-red-600 hover:border-red-600"
          >
            <Trash2 />
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete your
              Entitlement and remove your data from our servers.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600" onClick={deleteLeave}>
              {isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
