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

export function LeaveTypeChartData({ rawData }) {
  // Transform the raw MongoDB data for the chart
  const chartData = useMemo(() => {
    return rawData.map((item) => ({
      leaveType: item._id, // Renaming _id to leaveType
      totalLeaves: item.totalLeaves,
      fill: getRandomColor(),
    }));
  }, [rawData]);

  const chartConfig = {
    totalLeaves: {
      label: "Days Taken",
    },
  };
  return (
    <Card className={"flex flex-col"}>
      <CardHeader className="items-center pb-0">
        <CardTitle>Leave Days Taken by Type</CardTitle>
        <CardDescription>
          This chart shows the total leave days taken categorized by leave type.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex-1 pb-0">
        <LeaveChartData
          chartData={chartData}
          labelKey="leaveType"
          dataKey="totalLeaves"
          chartConfig={chartConfig}
        />
      </CardContent>
    </Card>
  );
}

export function LeaveStatusChartData({ rawData }) {
  // Transform the raw MongoDB data for the chart
  const chartData = useMemo(() => {
    return rawData.map((item) => ({
      leaveStatus: item._id, // Renaming _id to leaveStatus
      totalLeaves: item.totalLeaves,
      fill: getRandomColor(),
    }));
  }, [rawData]);

  const chartConfig = {
    totalLeaves: {
      label: "Days Taken",
    },
  };
  return (
    <Card className={"flex flex-col"}>
      <CardHeader className="items-center pb-0">
        <CardTitle>Leave Days Taken by Status</CardTitle>
        <CardDescription>
          This chart shows the total leave days taken categorized by leave
          status.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex-1 pb-0">
        <LeaveChartData
          chartData={chartData}
          labelKey="leaveStatus"
          dataKey="totalLeaves"
          chartConfig={chartConfig}
        />
      </CardContent>
    </Card>
  );
}

export function LeaveTypePieChartData({ rawData }) {
  // Define a standard palette of CSS variables from your theme
  const chartData = useMemo(() => {
    return rawData.map((item) => ({
      leaveType: item._id, // Renaming _id to leaveType
      totalLeaves: Number(item.totalLeaves),
      fill: getRandomColor(),
    }));
  }, [rawData]);
  const chartConfig = useMemo(() => {
    const configObj = {};

    rawData.forEach((item, index) => {
      configObj[item._id] = {
        label: item._id,
      };
    });

    return configObj;
  }, [rawData]);
  return (
    <Card className={"flex flex-col"}>
      <CardHeader className="items-center pb-0">
        <CardTitle>Leave Distribution Pie Chart</CardTitle>
        <CardDescription>
          This chart shows the distribution of leave days taken by type.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex-1 pb-0">
        <LeavePieChartData
          chartData={chartData}
          dataKey="totalLeaves"
          labelKey="leaveType"
          chartConfig={chartConfig}
        />
      </CardContent>
    </Card>
  );
}

export function LeaveStatusPieChartData({ rawData }) {
  // Define a standard palette of CSS variables from your theme
  const chartData = useMemo(() => {
    return rawData.map((item) => ({
      leaveStatus: item._id, // Renaming _id to leaveStatus
      totalLeaves: item.totalLeaves,
      fill: getRandomColor(),
    }));
  }, [rawData]);
  const chartConfig = useMemo(() => {
    const configObj = {};

    rawData.forEach((item, index) => {
      configObj[item._id] = {
        label: item._id,
      };
    });

    return configObj;
  }, [rawData]);
  return (
    <Card className={"flex flex-col"}>
      <CardHeader className="items-center pb-0">
        <CardTitle>Leave Distribution Pie Chart</CardTitle>
        <CardDescription>
          This chart shows the distribution of leave days taken by type.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex-1 pb-0">
        <LeavePieChartData
          chartData={chartData}
          dataKey="totalLeaves"
          labelKey="leaveStatus"
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
