"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { logScreenView } from "@/server/auditServer/screenViews";

/**
 * Records which screen the person is looking at.
 *
 * Mounted once, in the admin shell, rather than wired into each screen: there
 * are about thirty of them, a per-screen call is a line somebody forgets on the
 * thirty-first, and a screen nobody remembered to instrument reads exactly like
 * a screen nobody opens — which is the confusion this exists to end.
 *
 * Renders nothing and reports nothing. A failed write is swallowed by the
 * action; a failed call is swallowed here. Usage statistics must never be why a
 * page breaks.
 */
export default function ScreenViewLogger() {
  const pathname = usePathname();
  // Paths already recorded in this page session. Without it React's development
  // double-invoke counts every visit twice, and a component remounting on a
  // filter change would keep counting the same visit.
  const seen = useRef(new Set());

  useEffect(() => {
    if (!pathname || seen.current.has(pathname)) return;
    seen.current.add(pathname);

    // Deliberately not awaited: nothing on screen depends on the answer.
    logScreenView(pathname).catch(() => {});
  }, [pathname]);

  return null;
}
