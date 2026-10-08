"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { getDashboardDataServer } from "@/utils/dashData";
import { useTenantFeatures } from "@/hooks/useTenantFeatures";
import Greeting from "@/components/greeting/greeting";
import AnnouncementsCard from "./components/announcementsCard";
import AttendanceToday from "./components/attendanceToday";
import DashCount from "./components/dashCard";
import HoursTrend from "./components/hoursTrend";
import WhereTheyAre from "./components/whereTheyAre";

/**
 * The admin dashboard.
 *
 * It did not read as a dashboard because most of it was commented out: three
 * headcount cards and an announcements slot rendered, while the hours, the pay,
 * the ninety-day chart and the day's attendance sat behind a comment block.
 *
 * Reordered around what changes. A dashboard's first screenful should be the
 * things that are different from yesterday:
 *
 *   1. WHO IS IN, and anything needing attention.
 *   2. WHERE THEY ARE — the breakdown by location, which is the thing
 *      per-location clock records made possible and nothing surfaced.
 *   3. HOURS, over a fortnight.
 *   4. THE STANDING TOTALS last — how many people the company employs is a
 *      fact about the payroll, and it does not change between Tuesday and
 *      Wednesday. It opened the page before.
 *
 * NO PAY ON THIS SCREEN. It used to show today's total pay in a card and plot
 * it on the same axis as hours — two different units on one scale, which draws
 * a flat line and a spiky one and describes neither. Beyond being wrong it is
 * the wrong place: payroll figures belong behind the payroll screens, not on a
 * dashboard somebody leaves open while a colleague walks past.
 *
 * The table of who clocked in went too. A list of names and times is a thing
 * to read; the same people counted by place is a thing to notice.
 *
 * Spacing lives here rather than inside each card, which is why the old page
 * drifted: every block carried its own `px-4 md:px-8 py-4` and no two agreed.
 */
const Dash = () => {
  const { data } = useQuery({
    queryKey: ["dashboard"],
    queryFn: getDashboardDataServer,
  });

  const { has } = useTenantFeatures();

  const mergeData = useMemo(() => {
    if (!data) return [];

    try {
      return [
        {
          label: "All Employee Summary",
          value: JSON.parse(data.NumberOfficeEmployeeData?.data ?? "null"),
        },
        // Both of these count things a company without the module does not
        // have. Left in, they read as a real zero — "0 sites" invites someone
        // to go looking for the sites screen that their plan does not include.
        has("siteEmployees") && {
          label: "Immigrant Employee Summary",
          value: JSON.parse(data.NumberOfEmployeeData?.data ?? "null"),
        },
        has("siteProjects") && {
          label: "Total Site",
          value: JSON.parse(data.NumbertotalFullSiteData?.data ?? "null"),
        },
      ].filter(Boolean);
    } catch (e) {
      console.log("Failed to parse dashboard data:", e);
      return [];
    }
  }, [data, has]);

  const chartData = useMemo(
    () => data?.last90DaysDataForChartData || [],
    [data],
  );

  return (
    <main className="space-y-6 p-4 md:p-6">
      {/* The one place the greeting belongs: a landing page, once. It used to
          appear on every tab of Leave Management, Reports and Attendance and
          nowhere here — so the people who see this screen never got it and
          everybody else got it eight times. The date it carries is the right
          header for a dashboard that is deliberately about today. */}
      <Greeting />

      <AttendanceToday />

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <WhereTheyAre />
        <div className="space-y-4">
          <HoursTrend dayData={chartData} />
          {/* Renders nothing when there are no announcements, so it costs the
              dashboard no space until a company starts using the feature. */}
          <AnnouncementsCard />
        </div>
      </div>

      {/* Last on purpose: standing totals are a fact about the payroll, not
          about today. */}
      {mergeData.length ? <DashCount memoizedEmployeeData={mergeData} /> : null}
    </main>
  );
};

export default Dash;
