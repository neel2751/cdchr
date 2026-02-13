"use client";
import React, { useEffect, useState } from "react";
import { BellRing, CheckCircle, Share, PlusSquare, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { subscriberUser } from "@/lib/notifications";
import { toast } from "sonner";
import { useSession } from "next-auth/react";
import { sendTestNotification } from "@/server/attendanceServer/notificationServer";

export default function NotificationSetup() {
  const { data: session } = useSession();
  const userId = session?.user?._id;

  const [status, setStatus] = useState("loading");
  const [isIOS, setIsIOS] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [showIosPrompt, setShowIosPrompt] = useState(true);

  useEffect(() => {
    // 1. Check Notification Status
    if (!("Notification" in window)) {
      setStatus("unsupported");
    } else {
      setStatus(
        Notification.permission === "default"
          ? "prompt"
          : Notification.permission
      );
    }

    // 2. Browser Environment Checks
    const isIosDevice =
      /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    const isPWA =
      window.matchMedia("(display-mode: standalone)").matches ||
      navigator.standalone === true;

    setIsIOS(isIosDevice);
    setIsStandalone(isPWA);
  }, []);

  const handleSubscribe = async () => {
    const success = await subscriberUser(userId);
    if (success) {
      setStatus("granted");
      toast.success("Notifications enabled!");
    } else {
      toast.error("Failed to enable. Ensure you clicked 'Allow'.");
    }
  };

  // 1. IF ALREADY ACTIVE
  if (status === "granted" || status === "enabled") {
    return (
      <div className="flex flex-col gap-2 bg-green-50 p-4 rounded-xl border border-green-200">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-green-700 font-medium text-sm">
            <CheckCircle size={18} /> Notifications Active
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              sendTestNotification(userId).then((res) =>
                res.success
                  ? toast.success("Test sent!")
                  : toast.error("Failed")
              )
            }
            className="text-[10px] h-6 border-green-300 hover:bg-green-100"
          >
            Send Test
          </Button>
        </div>
      </div>
    );
  }

  // 2. IF ON IPHONE BUT NOT INSTALLED (The PWA Prompt)
  if (isIOS && !isStandalone && showIosPrompt) {
    return (
      <div className="relative border-2 border-blue-200 bg-blue-50 p-5 rounded-2xl shadow-sm">
        <button
          onClick={() => setShowIosPrompt(false)}
          className="absolute top-2 right-2 text-blue-400 hover:text-blue-600"
        >
          <X size={18} />
        </button>

        <div className="flex flex-col items-center text-center gap-3">
          <div className="bg-blue-100 p-3 rounded-full text-blue-600">
            <Share size={24} />
          </div>
          <h3 className="font-bold text-blue-900 leading-tight">
            Install App for Reminders
          </h3>
          <p className="text-xs text-blue-700">
            Notifications on iPhone require the app to be on your Home Screen:
          </p>

          <div className="w-full space-y-3 mt-1">
            <div className="flex items-center gap-3 text-sm text-blue-800 bg-white/50 p-2 rounded-lg">
              <span className="flex-none w-6 h-6 flex items-center justify-center bg-blue-600 text-white rounded-full text-[10px]">
                1
              </span>
              <p>
                Tap the{" "}
                <strong className="inline-flex items-center gap-1">
                  Share <Share size={14} />
                </strong>{" "}
                icon in Safari
              </p>
            </div>
            <div className="flex items-center gap-3 text-sm text-blue-800 bg-white/50 p-2 rounded-lg">
              <span className="flex-none w-6 h-6 flex items-center justify-center bg-blue-600 text-white rounded-full text-[10px]">
                2
              </span>
              <p>
                Scroll down and tap{" "}
                <strong>
                  Add to Home Screen <PlusSquare size={14} className="inline" />
                </strong>
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // 3. DEFAULT (Android / Desktop)
  return (
    <div className="border-2 border-dashed border-orange-200 bg-orange-50 p-4 rounded-xl flex flex-col gap-3 items-center text-center">
      <div className="bg-orange-100 p-3 rounded-full">
        <BellRing className="text-orange-600 animate-bounce" size={24} />
      </div>
      <div>
        <h3 className="font-semibold text-orange-900 leading-tight">
          Enable Reminders
        </h3>
        <p className="text-[11px] text-orange-700 mt-1">
          Don't forget to clock out! Get a nudge on your device.
        </p>
      </div>
      <Button
        onClick={handleSubscribe}
        className="bg-orange-600 hover:bg-orange-700 w-full text-sm h-10 font-medium transition-all active:scale-95"
      >
        Allow Notifications
      </Button>
      {status === "denied" && (
        <p className="text-[10px] text-red-600 bg-red-50 p-2 rounded border border-red-100">
          Notifications are blocked. Reset permissions in browser settings.
        </p>
      )}
    </div>
  );
}
