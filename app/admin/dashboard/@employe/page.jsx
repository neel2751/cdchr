import React from "react";

import NotificationSetup from "@/components/notificationBanner";
import AnnouncementsCard from "../components/announcementsCard";
import EmployeCard from "../components/employe-card";

/**
 * An employee's dashboard.
 *
 * The page used to be three stacked blocks with their own padding —
 * `p-4 mb-4`, `px-4 mb-4`, then a container with `p-4` inside it — in three
 * visual languages: a dashed orange banner with a bouncing bell, a card, and
 * the clock UI in a box with `mt-20` pushing it below the fold.
 *
 * One column, one width, one rhythm now, and ordered by what somebody came
 * for: the clock first, then anything they need to read, then the optional
 * offer last. The reminder prompt used to be first and loudest, which is
 * backwards — it is the least important thing here and the only one that can
 * be declined.
 */
export default function Page() {
  return (
    <main className="mx-auto w-full max-w-xl space-y-4 p-4">
      <EmployeCard />
      <AnnouncementsCard />
      <NotificationSetup />
    </main>
  );
}
