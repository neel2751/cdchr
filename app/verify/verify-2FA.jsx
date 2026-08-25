import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import TwoFAConfirmModal from "@/components/TwoFAConfirmModel";
import { toast } from "sonner";
import { useSession } from "next-auth/react";
import { homePathForRole } from "@/lib/roleHome";

export default function VerifyTwoFactor() {
  const [open, setOpen] = useState(true);
  const router = useRouter();
  const { data: session, status, update } = useSession();

  useEffect(() => {
    // Only run this check after session is loaded
    if (status !== "loading") {
      // If user is authenticated but doesn't need 2FA, redirect them away
      if (session && !session?.user?.requiresTwoFactor) {
        router.push(homePathForRole(session?.user?.role));
      }
    }
  }, [session, status, router]);

  const onSuccess = async () => {
    // Wait for the session/JWT cookie to update before navigating, then do a
    // full-page navigation so middleware re-evaluates with the fresh token
    // (a client-side router.push can run before the cookie propagates, which is
    // why it previously needed a manual refresh).
    await update({ twoFactorVerified: true });
    setOpen(false);
    toast.success("Two-factor authentication verified");
    window.location.assign(homePathForRole(session?.user?.role));
  };

  return (
    <>
      {status === "loading" ? (
        <div className="flex items-center justify-center h-screen">
          <p>Loading...</p>
        </div>
      ) : (
        <TwoFAConfirmModal
          open={open}
          onClose={setOpen}
          onSuccess={onSuccess}
        />
      )}
    </>
  );
}
