"use client";
import { Button } from "@/components/ui/button";
import { useSubmitMutation } from "@/hooks/use-mutate";
import { testSMTPConnection } from "@/server/email/emailSMTP";
import { Loader2Icon, SendIcon } from "lucide-react";

export default function EmailTest({ data }) {
  const { mutate: handleTestEmail, isPending } = useSubmitMutation({
    mutationFn: async () => await testSMTPConnection(data),
    onSuccessMessage: (message) => message || "Test email sent successfully!",
    onClose: () => {},
  });

  return (
    <Button
      size={"icon"}
      variant={"outline"}
      onClick={handleTestEmail}
      disabled={isPending}
    >
      {isPending ? <Loader2Icon className="animate-spin" /> : <SendIcon />}
    </Button>
  );
}
