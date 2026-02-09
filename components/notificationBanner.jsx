"use client";
import React, { useEffect, useState } from "react";
import { BellRing, BellOff, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { subscriberUser } from "@/lib/notifications"; // The helper we made earlier
import { toast } from "sonner";
import { useSession } from "next-auth/react";
import { sendTestNotification } from "@/server/attendanceServer/notificationServer";

export default function NotificationSetup() {
  const { data } = useSession();
  const userId = data?.user?._id;

  const [status, setStatus] = useState("loading"); // loading, prompt, enabled, blocked

  useEffect(() => {
    if (!("Notification" in window)) {
      setStatus("unsupported");
    } else if (Notification.permission === "granted") {
      setStatus("enabled");
    } else if (Notification.permission === "denied") {
      setStatus("blocked");
    } else {
      setStatus("prompt");
    }
  }, []);

  const handleSubscribe = async () => {
    const success = await subscriberUser(userId);
    if (success) {
      setStatus("enabled");
      toast.success("Notifications enabled!");
    } else {
      toast.error("Permission denied or error occurred.");
    }
  };

  const handleTest = async () => {
    const res = await sendTestNotification(userId);
    if (res.success) {
      toast.success("Test notification sent! Check your desktop/phone.");
    } else {
      toast.error("Test failed. Check your browser settings.");
    }
  };

  if (status === "enabled")
    return (
      <div className="flex flex-col gap-2 bg-green-50 p-4 rounded-xl border border-green-200">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-green-700 font-medium">
            <CheckCircle size={18} /> Notifications Active
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleTest}
            className="text-xs h-7 border-green-300 hover:bg-green-100 cursor-pointer"
          >
            Send Test
          </Button>
        </div>
        <p className="text-[11px] text-green-600">
          You will receive reminders here even if this tab is closed.
        </p>
      </div>
    );

  return (
    <div className="border-2 border-dashed border-orange-200 bg-orange-50 p-4 rounded-xl flex flex-col gap-3 items-center text-center">
      <div className="bg-orange-100 p-3 rounded-full">
        <BellRing className="text-orange-600 animate-bounce" size={24} />
      </div>
      <div>
        <h3 className="font-semibold text-orange-900">Enable Reminders</h3>
        <p className="text-xs text-orange-700">
          Don't forget to clock out! Get a nudge on your desktop/phone.
        </p>
      </div>
      <Button
        onClick={handleSubscribe}
        variant="default"
        className="bg-orange-600 hover:bg-orange-700 w-full"
      >
        Allow Notifications
      </Button>
      {status === "blocked" && (
        <p className="text-[11px] text-red-600">
          Notifications are blocked. Please enable them in your browser
          settings.
        </p>
      )}
    </div>
  );
}
