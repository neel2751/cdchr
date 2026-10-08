"use client";

import { format } from "date-fns";
import { useSession } from "next-auth/react";

import { MINUTE, useTime } from "@/hooks/useTime";

/**
 * "Good afternoon, Neel" — once, on the dashboard.
 *
 * WHERE THIS USED TO APPEAR. The same component existed twice, byte for byte —
 * `components/gretting/gretting.jsx` and `app/admin/_components/name.jsx` — and
 * the first was dropped into the children slot of the tab navigation for Leave
 * Management, Reports and Attendance. That slot sits between the tab bar and the
 * content, so the greeting repeated on all eight leave tabs: changing tab showed
 * the same "Good Afternoon, Neel 👋" again, in the place where the name of the
 * screen should be.
 *
 * It was also redundant for orientation twice over — the active tab is already
 * highlighted, and every one of those screens renders its own card title
 * underneath. So it is now on the dashboard only, which is where somebody lands
 * and where a greeting is the point rather than an interruption.
 *
 * WHAT WAS WRONG WITH IT.
 *
 *   · `session?.user?.name` is undefined until the session resolves, so the
 *     first paint read "Good Afternoon,  👋" — a greeting with a dangling comma
 *     and nobody's name in it.
 *   · The hour was read once during render and never again. A tab left open from
 *     the morning said "Good Morning" all afternoon. It now ticks, through the
 *     shared ticker in hooks/useTime.js.
 *   · Reading the clock during render of a client component also means the
 *     server renders the server's hour and the browser re-renders the browser's,
 *     which is a hydration mismatch whenever the two disagree — and they
 *     disagree for most of the day if the server is on UTC and the user is not.
 *   · A green dot pulsed next to it whenever `status === "authenticated"`, which
 *     is to say permanently, for somebody who is by definition looking at the
 *     signed-in app. Constant motion carrying no information.
 *   · `CardTitle` was used outside any Card.
 *
 * It now earns the space by carrying the date as well, which is the one piece of
 * context a dashboard greeting can usefully add.
 */

/**
 * The greeting for an hour of the day.
 *
 * Three, not four. The original had a fourth — "Good Night" from 8pm to 5am —
 * which reads as a farewell rather than a greeting, and is an odd thing to say
 * to somebody who has just opened their timesheet.
 */
function greetingFor(hours) {
  if (hours >= 5 && hours < 12) return "Good morning";
  if (hours >= 12 && hours < 17) return "Good afternoon";
  return "Good evening";
}

/**
 * The name to use.
 *
 * First name only: "Good afternoon, Neel" is how a person would say it, and the
 * full name on a greeting reads like a letter from a bank.
 */
function firstNameOf(name) {
  const trimmed = String(name || "").trim();
  if (!trimmed) return "";
  return trimmed.split(/\s+/)[0];
}

export default function Greeting() {
  const { data: session, status } = useSession();

  // Null until mounted, so the clock is only ever read in the browser — see
  // hooks/useTime.js. A minute, not a second: this changes three times a day.
  const now = useTime(MINUTE);

  const firstName = firstNameOf(session?.user?.name);

  // Nothing is shown until both the hour and the name are known. A greeting is
  // not worth a layout shift or a half-written sentence, and the space it would
  // occupy is reserved so the clock below it does not jump.
  const ready = now !== null && status === "authenticated" && firstName;

  return (
    <div className="min-h-[2.75rem] ms-1">
      {ready ? (
        <>
          <h1 className="text-lg font-semibold leading-tight tracking-tight">
            {greetingFor(now.getHours())}, {firstName}
          </h1>
          <p className="text-sm text-muted-foreground">
            {format(now, "EEEE d MMMM")}
          </p>
        </>
      ) : null}
    </div>
  );
}
