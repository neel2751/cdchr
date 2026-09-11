"use client";
import { useMemo } from "react";
import DashCount from "./components/dashCard";
import { useQuery } from "@tanstack/react-query";
import { getDashboardDataServer } from "@/utils/dashData";
import TodayCard from "./components/todayCard";
import Overview from "./components/overview";
import RecentData from "./components/recentData";
import AnnouncementsCard from "./components/announcementsCard";
import { useTenantFeatures } from "@/hooks/useTenantFeatures";

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
    return {
      ...data.CurrentDayTotalPay,
      employees: JSON.parse(data.CurrentDayTotalPay?.employees),
    };
  }, [data]);

  const chartData = useMemo(
    () => data?.last90DaysDataForChartData || [],
    [data]
  );
  return (
    <>
      {/* Office Employee Data */}
      {mergeData && <DashCount memoizedEmployeeData={mergeData} />}

      {/* Renders nothing when there are no announcements, so it costs the
          dashboard no space until a company starts using the feature. */}
      <div className="sm:px-8 px-4 pb-4">
        <AnnouncementsCard />
      </div>

      {/* <div className="sm:px-8 px-4 py-4 lg:flex gap-x-8 w-full">
        <div className="flex flex-col lg:w-1/2 gap-8">
          <div className="flex gap-8">
            <TodayCard
              title={"Total Pay"}
              value={today?.totalPay || 0}
              supportText={"Today"}
            />
            <TodayCard
              title={"Total Hours"}
              value={today?.totalHours || 0}
              supportText={"Hours"}
            />
          </div>
          <Overview dayData={chartData} />
        </div>
        <div className="lg:w-1/2 sm:mt-0 mt-8">
          <RecentData data={today?.employees} />
        </div>
      </div> */}
    </>
  );
};

export default Dash;
