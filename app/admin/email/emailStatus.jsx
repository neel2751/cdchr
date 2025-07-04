"use client";
import { useSubmitMutation } from "@/hooks/use-mutate";
import { TableStatus } from "@/components/tableStatus/status";
import { updateSMTPStatusAdvance } from "@/server/email/emailSMTP";

export default function EmailStatus({ data, queryKey }) {
  const { mutate: handleEmailStatus, isPending } = useSubmitMutation({
    mutationFn: async () =>
      await updateSMTPStatusAdvance(data?._id, { isActive: !data.isActive }),
    invalidateKey: queryKey || ["getAllSMTPsAdvance"],
    onSuccessMessage: (message) =>
      message || "Email status updated successfully!",
    onClose: () => {},
  });

  return (
    <TableStatus
      isActive={data.isActive}
      handleClick={handleEmailStatus}
      isPending={isPending}
    />
  );
}
