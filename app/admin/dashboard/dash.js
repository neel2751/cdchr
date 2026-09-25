"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { getDashboardDataServer } from "@/utils/dashData";
import { useTenantFeatures } from "@/hooks/useTenantFeatures";
import AnnouncementsCard from "./components/announcementsCard";
import AttendanceToday from "./components/attendanceToday";
import DashCount from "./components/dashCard";
import Overview from "./components/overview";
import RecentData from "./components/recentData";
import TodayCard from "./components/todayCard";

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
 *   1. WHO IS IN, and anything needing attention. The question an attendance
 *      system exists to answer, and the one nobody could ask here.
 *   2. TODAY'S HOURS AND PAY, which is the day in two numbers.
 *   3. WHO CLOCKED IN, so a name can be checked rather than a total.
 *   4. THE TREND, over ninety days.
 *   5. THE STANDING TOTALS last — how many people the company employs is a
 *      fact about the payroll, and it does not change between Tuesday and
 *      Wednesday. It opened the page before.
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

  const today = useMemo(() => {
    if (!data?.CurrentDayTotalPay) return null;
    try {
      return {
        ...data.CurrentDayTotalPay,
        employees: JSON.parse(data.CurrentDayTotalPay?.employees ?? "null"),
      };
    } catch {
      // A malformed payload should cost the page one card, not the whole
      // dashboard.
      return null;
    }
  }, [data]);

  const chartData = useMemo(
    () => data?.last90DaysDataForChartData || [],
    [data],
  );

  return (
    <main className="space-y-6 p-4 md:p-6">
      <AttendanceToday />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <div className="grid gap-4 sm:grid-cols-2">
            <TodayCard
              title="Total Hours"
              value={today?.totalHours || 0}
              supportText="today"
            />
            <TodayCard
              title="Total Pay"
              value={today?.totalPay || 0}
              supportText="today"
            />
          </div>
          <Overview dayData={chartData} />
        </div>

        <div className="space-y-4">
          <RecentData data={today?.employees} />
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
