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

/**
 * Take one leave type off one employee, for one leave year.
 *
 * A soft delete — the row stays on the entitlement document so the days already
 * taken under it keep something to refer to, and Restore puts it back. The
 * dialog said "permanently delete your Entitlement and remove your data from our
 * servers", which was wrong twice: nothing is removed, and it is the employee's
 * entitlement, not the admin's.
 *
 * The server refuses when days have already been booked against the type, so the
 * message it returns is shown rather than a fixed "Leave Deleted successfully".
 */
export default function LeaveDelete({
  leaveType,
  leaveYear,
  employeeId,
  employeeName,
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
    onSuccessMessage: (message) => message || "Leave removed",
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
            <AlertDialogTitle>
              Remove {leaveType}
              {employeeName ? ` from ${employeeName}` : ""}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              They will no longer be able to book {leaveType} in {leaveYear}, and
              it will stop appearing on their leave summary. Nothing is deleted —
              the record is kept and you can restore it from this screen. If days
              have already been booked against it, use Hide instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600" onClick={deleteLeave}>
              {isPending ? "Removing..." : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
