"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { io } from "socket.io-client";

/**
 * Refresh the announcement views when one is published.
 *
 * The server sends only an id, never the announcement, so this refetches
 * through the normal server actions — which is what keeps the audience check on
 * the server. A client told "here is a new announcement" would have to be
 * trusted to decide whether it was for them.
 *
 * Mounted alongside the bell, so it runs once per page rather than once per
 * component that displays announcements.
 */
export function useAnnouncementSocket(enabled = true) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled) return;

    // The cookie is what authenticates the socket (see makeSocketAuth), so the
    // connection must be credentialed and same-origin.
    const socket = io({ withCredentials: true });

    const refresh = () => {
      queryClient.invalidateQueries({ queryKey: ["myAnnouncements"] });
      queryClient.invalidateQueries({ queryKey: ["myAnnouncementsUnread"] });
      queryClient.invalidateQueries({ queryKey: ["urgentAnnouncements"] });
    };

    socket.on("announcement:new", refresh);

    return () => {
      socket.off("announcement:new", refresh);
      socket.disconnect();
    };
  }, [enabled, queryClient]);
}
