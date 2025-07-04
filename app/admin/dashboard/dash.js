"use client";
import { useMemo } from "react";
import DashCount from "./components/dashCard";
import TodayCard from "./components/todayCard";
import Overview from "./components/overview";
import RecentData from "./components/recentData";
import { useQuery } from "@tanstack/react-query";
import { getDashboardDataServer } from "@/utils/dashData";

const Dash = () => {
  const { data } = useQuery({
    queryKey: ["dashboard"],
    queryFn: getDashboardDataServer,
  });

  const mergeData = useMemo(() => {
    if (!data) return [];

    try {
      return [
        {
          label: "All Employee Summary",
          value: JSON.parse(data.NumberOfficeEmployeeData?.data ?? "null"),
        },
        {
          label: "Immigrant Employee Summary",
          value: JSON.parse(data.NumberOfEmployeeData?.data ?? "null"),
        },
        {
          label: "Total Site",
          value: JSON.parse(data.NumbertotalFullSiteData?.data ?? "null"),
        },
      ];
    } catch (e) {
      console.error("Failed to parse dashboard data:", e);
      return [];
    }
  }, [data]);

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
      <div className="sm:px-8 px-4 py-4 lg:flex gap-x-8 w-full">
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
          {/* <ChartComponent chartData={chartData} /> */}
        </div>
        <div className="lg:w-1/2 sm:mt-0 mt-8">
          <RecentData data={today?.employees} />
        </div>
      </div>
    </>
  );
};

export default Dash;
