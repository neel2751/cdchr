"use client";
import { useEffect, useMemo, useState } from "react";
import { Bell } from "lucide-react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useFetchQuery } from "@/hooks/use-query";
import { getVisaNotifications } from "@/server/notificationServer/visaNotificationServer";
import { VISA_URGENCY_TEXT } from "@/lib/visaMilestones";

// Which notification ids the user has already seen. Persisted per-browser so the
// unread badge clears after they open the bell, and reappears when a NEW alert
// (or an escalation, e.g. expiring -> expired) shows up.
const SEEN_KEY = "visaNotifSeen";

export default function NotificationBell() {
  const { data: session } = useSession();
  const role = session?.user?.role;
  const isPrivileged = role === "admin" || role === "superAdmin";

  const [seen, setSeen] = useState([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SEEN_KEY);
      if (raw) setSeen(JSON.parse(raw));
    } catch {
      // ignore malformed storage
    }
  }, []);

  const { data } = useFetchQuery({
    queryKey: ["visaNotifications"],
    fetchFn: getVisaNotifications,
    enabled: isPrivileged,
  });
  const { newData: notifications = [] } = data || {};

  const unreadCount = useMemo(
    () => notifications.filter((n) => !seen.includes(n.id)).length,
    [notifications, seen],
  );

  const markAllSeen = () => {
    const ids = notifications.map((n) => n.id);
    setSeen(ids);
    try {
      localStorage.setItem(SEEN_KEY, JSON.stringify(ids));
    } catch {
      // ignore storage errors (e.g. private mode)
    }
  };

  if (!isPrivileged) return null;

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) markAllSeen();
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          title="Visa alerts"
        >
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-semibold text-white">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <p className="text-sm font-semibold">Visa alerts</p>
          <span className="text-xs text-muted-foreground">
            {notifications.length} total
          </span>
        </div>
        {notifications.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            No visa alerts right now.
          </p>
        ) : (
          <ScrollArea className="max-h-96">
            <ul className="divide-y">
              {notifications.map((n) => (
                <li key={n.id}>
                  <Link
                    href={n.href}
                    onClick={() => setOpen(false)}
                    className="block px-4 py-3 transition-colors hover:bg-muted/50"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={`text-xs font-semibold ${
                          VISA_URGENCY_TEXT[n.urgency] || ""
                        }`}
                      >
                        {n.title}
                      </span>
                      <span className="text-[11px] uppercase text-muted-foreground">
                        {n.type === "office" ? "Office" : "Field"}
                      </span>
                    </div>
                    <p className="mt-0.5 text-sm text-foreground">{n.message}</p>
                  </Link>
                </li>
              ))}
            </ul>
          </ScrollArea>
        )}
      </PopoverContent>
    </Popover>
  );
}
