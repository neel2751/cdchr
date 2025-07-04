import { Button } from "@/components/ui/button";
import { useSubmitMutation } from "@/hooks/use-mutate";
import { syncMissingLeaveTypesNew } from "@/server/leaveServer/countLeaveServer";
import { syncMissingLeaveTypes } from "@/server/leaveServer/leaveServer";
import { ScanSearch } from "lucide-react";

export default function LeaveScan({ item, queryKey }) {
  const { mutate: handleScan, isPending } = useSubmitMutation({
    invalidateKey: queryKey,
    mutationFn: async (data) =>
      syncMissingLeaveTypesNew(data.joinDate, data.dayPerWeek, data._id),
    onSuccessMessage: (response) => response,
    onClose: () => console.log("Scan closed"),
  });
  return (
    <Button
      disabled={isPending}
      onClick={() => handleScan(item)}
      size="icon"
      variant="outline"
    >
      <ScanSearch />
    </Button>
  );
}
