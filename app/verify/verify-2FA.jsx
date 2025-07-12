import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import TwoFAConfirmModal from "@/components/TwoFAConfirmModel";
import { toast } from "sonner";
import { useSession } from "next-auth/react";

export default function VerifyTwoFactor() {
  const [open, setOpen] = useState(true);
  const router = useRouter();
  const { data: session, status, update } = useSession();

  useEffect(() => {
    // Only run this check after session is loaded
    if (status !== "loading") {
      // If user is authenticated but doesn't need 2FA, redirect them away
      if (session && !session?.user?.requiresTwoFactor) {
        session?.user?.role === "siteEmployee"
          ? router.push("/employee")
          : router.push("/admin/dashboard");
        router.push("/admin/dashboard");
      }
    }
  }, [session, status, router]);

  const onSuccess = () => {
    update({
      twoFactorVerified: true,
    });
    setOpen(false);
    session?.user?.role === "siteEmployee"
      ? router.push("/employee")
      : router.push("/admin/dashboard");
    router.push("/admin/dashboard");
    toast.success("Two-factor authentication verified");
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
