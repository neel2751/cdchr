import { Button } from "@/components/ui/button";
import { useSubmitMutation } from "@/hooks/use-mutate";
import { restoreOneCommonLeaveToOneEmployee } from "@/server/leaveServer/entitlementServer";
import { HistoryIcon } from "lucide-react";

/**
 * Put a removed leave type back on one employee.
 *
 * The entitlement sheet already rendered a "Restore" button for a row marked
 * `isDelete` — with no handler on it. It looked like a working control, clicked
 * like one, and did nothing at all. This is the action it was missing.
 */
export default function LeaveRestore({
  leaveType,
  leaveYear,
  employeeId,
  queryKey,
}) {
  const { mutate: restore, isPending } = useSubmitMutation({
    mutationFn: async () =>
      await restoreOneCommonLeaveToOneEmployee({
        leaveType,
        leaveYear,
        employeeId,
      }),
    invalidateKey: queryKey,
    onSuccessMessage: (message) => message || "Leave restored",
    onClose: () => {},
  });

  return (
    <Button
      size="sm"
      variant="outline"
      onClick={() => restore()}
      disabled={isPending}
    >
      <HistoryIcon />
      {isPending ? "Restoring..." : "Restore"}
    </Button>
  );
}
