"use client";

import { useEffect, useState, useTransition } from "react";
import { useSession } from "next-auth/react";
import { Eye, Loader2, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { endSupportSession } from "@/server/tenantServer/supportServer";

/**
 * Fixed banner shown for the whole of a support visit.
 *
 * Deliberately loud and not dismissible. Someone looking at a customer's data
 * should never be able to forget whose data it is, and the countdown makes the
 * time limit visible rather than a surprise.
 */
const SupportBanner = () => {
  const { data: session, update } = useSession();
  const visit = session?.user?.impersonation;
  const [remaining, setRemaining] = useState("");
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!visit?.expiresAt) return;
    const tick = () => {
      const ms = new Date(visit.expiresAt) - Date.now();
      if (ms <= 0) {
        setRemaining("expired");
        // Ask the server to re-read the record; it will find the visit lapsed
        // and drop it, returning this account to the platform console.
        update({ refreshSupport: true }).then(() =>
          window.location.assign("/platform")
        );
        return;
      }
      const mins = Math.floor(ms / 60000);
      const secs = Math.floor((ms % 60000) / 1000);
      setRemaining(`${mins}:${String(secs).padStart(2, "0")}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [visit?.expiresAt, update]);

  if (!visit) return null;

  const end = () =>
    startTransition(async () => {
      const res = await endSupportSession();
      if (!res?.success) return toast.error(res?.message || "Could not end");
      await update({ refreshSupport: true });
      window.location.assign("/platform");
    });

  return (
    <div
      role="status"
      className="sticky top-0 z-50 flex flex-wrap items-center justify-between gap-2 bg-amber-500 px-4 py-2 text-sm text-amber-950"
    >
      <span className="flex items-center gap-2 font-medium">
        <Eye className="size-4 shrink-0" />
        Read-only support session on{" "}
        <strong>{visit.tenantName || "this company"}</strong>
        <span className="rounded bg-amber-950/15 px-1.5 py-0.5 font-mono text-xs">
          {remaining}
        </span>
      </span>
      <span className="flex items-center gap-3">
        <span className="hidden text-xs sm:inline">
          Changes are blocked while this is active.
        </span>
        <Button
          size="sm"
          variant="outline"
          className="border-amber-950/30 bg-amber-50 hover:bg-white"
          disabled={isPending}
          onClick={end}
        >
          {isPending ? <Loader2 className="size-4 animate-spin" /> : <X className="size-4" />}
          End session
        </Button>
      </span>
    </div>
  );
};

export default SupportBanner;
