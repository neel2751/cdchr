import { Button } from "@/components/ui/button";
import { useSubmitMutation } from "@/hooks/use-mutate";
import { recomputeCarryForward } from "@/server/leaveServer/carryExpiryServer";
import { RefreshCw } from "lucide-react";

/**
 * Re-apply the carry-forward rules to an entitlement that already exists.
 *
 * Carry-forward is worked out once, when the leave year is generated. So
 * narrowing a rule — or setting one person to "never carry" — does nothing to
 * days already granted back at the start of the year, and the scan button next
 * to this one deliberately skips anybody who already has a record. Without this
 * the eligibility settings would be a change that only took effect next April.
 *
 * It will not take back days already taken: if they carried ten and spent four,
 * the four stay. See recomputeCarryForward() for why, and what the history
 * entry says about it.
 */
export default function LeaveRecomputeCarry({ item, queryKey }) {
  const { mutate: recompute, isPending } = useSubmitMutation({
    mutationFn: async () =>
      await recomputeCarryForward({
        employeeId: item?._id,
        leaveYear: item?.leaveYear,
      }),
    invalidateKey: queryKey,
    onSuccessMessage: (message) => message || "Carry-forward recalculated",
    onClose: () => {},
  });

  return (
    <Button
      size="sm"
      variant="outline"
      onClick={() => recompute()}
      disabled={isPending || !item?.leaveYear}
      title="Re-apply the carry-forward rules to this leave year"
    >
      <RefreshCw className={isPending ? "animate-spin" : ""} />
      {isPending ? "Recalculating..." : "Recalculate carry-over"}
    </Button>
  );
}
