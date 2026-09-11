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
import { useFetchQuery, useFetchSelectQuery } from "@/hooks/use-query";
import { useAnnouncementSocket } from "@/hooks/useAnnouncementSocket";
import { getVisaNotifications } from "@/server/notificationServer/visaNotificationServer";
import {
  getMyAnnouncements,
  getMyUnreadCount,
} from "@/server/announcementServer/myAnnouncementServer";
import { VISA_URGENCY_TEXT } from "@/lib/visaMilestones";

// Which visa notification ids the user has already seen. Persisted per-browser so
// the unread badge clears after they open the bell, and reappears when a NEW
// alert (or an escalation, e.g. expiring -> expired) shows up.
//
// Announcements deliberately do NOT work this way: their read state lives on the
// server as a receipt, because an author reporting on who has read a safety
// notice cannot be told "it was in their browser's localStorage". Opening the
// bell is therefore not enough to clear that half of the badge — opening the
// announcement is.
const SEEN_KEY = "visaNotifSeen";

// Enough to be useful in a popover; the full list is one click away.
const BELL_ANNOUNCEMENT_LIMIT = 5;

export default function NotificationBell() {
  const { data: session } = useSession();
  const role = session?.user?.role;
  const isPrivileged = role === "admin" || role === "superAdmin";
  const signedIn = !!session?.user?._id;

  const [seen, setSeen] = useState([]);
  const [open, setOpen] = useState(false);

  // One socket per page, mounted here because the bell is in the shell.
  useAnnouncementSocket(signedIn);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SEEN_KEY);
      if (raw) setSeen(JSON.parse(raw));
    } catch {
      // ignore malformed storage
    }
  }, []);

  // Visa alerts are an HR concern and stay privileged-only. Announcements are
  // for everyone, which is why this component no longer bails out early for
  // ordinary staff — it gates per section instead.
  const { data: visaData } = useFetchQuery({
    queryKey: ["visaNotifications"],
    fetchFn: getVisaNotifications,
    enabled: isPrivileged,
  });
  const { newData: visaAlerts = [] } = visaData || {};

  const { data: announcementData } = useFetchQuery({
    queryKey: ["myAnnouncements", { bell: true }],
    params: { page: 1, pageSize: BELL_ANNOUNCEMENT_LIMIT },
    fetchFn: getMyAnnouncements,
    enabled: signedIn,
  });
  const { newData: announcements = [] } = announcementData || {};

  // Counted server-side rather than derived from the five rows above, so the
  // badge reflects everything addressed to this person, not just the page shown.
  // useFetchSelectQuery has no `enabled` option; the action returns zero when
  // there is no session, so an early call is harmless.
  const { data: unreadAnnouncements } = useFetchSelectQuery({
    queryKey: ["myAnnouncementsUnread"],
    fetchFn: getMyUnreadCount,
  });

  const unreadVisa = useMemo(
    () => visaAlerts.filter((n) => !seen.includes(n.id)).length,
    [visaAlerts, seen],
  );

  const unreadCount = unreadVisa + (unreadAnnouncements?.count || 0);

  const markVisaSeen = () => {
    const ids = visaAlerts.map((n) => n.id);
    setSeen(ids);
    try {
      localStorage.setItem(SEEN_KEY, JSON.stringify(ids));
    } catch {
      // ignore storage errors (e.g. private mode)
    }
  };

  if (!signedIn) return null;

  const hasNothing = !announcements.length && !visaAlerts.length;

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) markVisaSeen();
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          title="Notifications"
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
        {hasNothing ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            Nothing new right now.
          </p>
        ) : (
          <ScrollArea className="max-h-[28rem]">
            {announcements.length > 0 && (
              <>
                <div className="flex items-center justify-between border-b px-4 py-3">
                  <p className="text-sm font-semibold">Announcements</p>
                  <Link
                    href="/admin/my-announcements"
                    onClick={() => setOpen(false)}
                    className="text-xs text-muted-foreground hover:underline"
                  >
                    See all
                  </Link>
                </div>
                <ul className="divide-y">
                  {announcements.map((a) => (
                    <li key={a._id}>
                      <Link
                        href={`/admin/my-announcements/${a._id}`}
                        onClick={() => setOpen(false)}
                        className="block px-4 py-3 transition-colors hover:bg-muted/50"
                      >
                        <div className="flex items-center gap-2">
                          {!a.readAt && (
                            <span
                              className="size-2 shrink-0 rounded-full bg-blue-600"
                              aria-label="Unread"
                            />
                          )}
                          <span
                            className={`text-sm ${
                              a.readAt ? "font-medium" : "font-semibold"
                            }`}
                          >
                            {a.title}
                          </span>
                        </div>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {a.createdByName || "Your company"}
                          {a.requireAck && !a.acknowledgedAt
                            ? " · needs acknowledgement"
                            : ""}
                        </p>
                      </Link>
                    </li>
                  ))}
                </ul>
              </>
            )}

            {isPrivileged && visaAlerts.length > 0 && (
              <>
                <div className="flex items-center justify-between border-y px-4 py-3">
                  <p className="text-sm font-semibold">Visa alerts</p>
                  <span className="text-xs text-muted-foreground">
                    {visaAlerts.length} total
                  </span>
                </div>
                <ul className="divide-y">
                  {visaAlerts.map((n) => (
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
                        <p className="mt-0.5 text-sm text-foreground">
                          {n.message}
                        </p>
                      </Link>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </ScrollArea>
        )}
      </PopoverContent>
    </Popover>
  );
}
