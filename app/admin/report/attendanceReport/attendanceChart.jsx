import {
  ReusablePieChart,
  ReusableReportChart,
} from "@/components/charts/charts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useMemo } from "react";

function getRandomColor() {
  const letters = "0123456789ABCDEF";
  let color = "#";
  for (let i = 0; i < 6; i++) {
    color += letters[Math.floor(Math.random() * 16)];
  }
  return color;
}

export function AttendanceChartData({ rawData }) {
  // Transform the raw MongoDB data for the chart
  const chartData = useMemo(() => {
    return rawData.map((item) => ({
      name: item.name, // Renaming _id to leaveType
      totalDays: item.totalDays,
      fill: getRandomColor(),
    }));
  }, [rawData]);

  const chartConfig = {
    totalDays: {
      label: "Total Days",
    },
  };
  return (
    <Card className={"flex flex-col"}>
      <CardHeader className="items-center pb-0">
        <CardTitle>Attendance Report Bar Chart</CardTitle>
        <CardDescription>
          This chart shows the total number of days attended by each employee.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex-1 pb-0">
        <LeaveChartData
          chartData={chartData}
          dataKey="totalDays"
          labelKey="name"
          chartConfig={chartConfig}
        />
      </CardContent>
    </Card>
  );
}

export function AttendancePieChartData({ rawData }) {
  // Define a standard palette of CSS variables from your theme
  const chartData = useMemo(() => {
    return rawData.map((item) => ({
      name: item.name, // Renaming _id to leaveType
      totalDays: Number(item.totalDays),
      fill: getRandomColor(),
    }));
  }, [rawData]);
  const chartConfig = useMemo(() => {
    const configObj = {};

    rawData.forEach((item) => {
      configObj[item.name] = {
        label: item.name,
      };
    });

    return configObj;
  }, [rawData]);
  return (
    <Card className={"flex flex-col"}>
      <CardHeader className="items-center pb-0">
        <CardTitle>Attendance Report Pie Chart</CardTitle>
        <CardDescription>
          This pie chart represents the distribution of attendance days among
          employees.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex-1 pb-0">
        <LeavePieChartData
          chartData={chartData}
          dataKey="totalDays"
          labelKey="name"
          chartConfig={chartConfig}
        />
      </CardContent>
    </Card>
  );
}

function LeaveChartData({ chartData, chartConfig, labelKey, dataKey }) {
  return (
    <ReusableReportChart
      data={chartData}
      labelKey={labelKey}
      dataKey={dataKey}
      config={chartConfig}
    />
  );
}

function LeavePieChartData({ chartData, chartConfig, labelKey, dataKey }) {
  return (
    <ReusablePieChart
      data={chartData}
      nameKey={labelKey}
      dataKey={dataKey}
      config={chartConfig}
    />
  );
}
