"use client";

import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { useFetchQuery } from "@/hooks/use-query";
import {
  getVisitorCountByPurpose,
  getVisitorCountByType,
} from "@/server/visitorServer";
import { memo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  XAxis,
  YAxis,
} from "recharts";

export default function VisitorCount() {
  const { data } = useFetchQuery({
    fetchFn: getVisitorCountByType,
    queryKey: ["visitorCount"],
  });
  const { newData } = data || {};

  const { data: purpose } = useFetchQuery({
    fetchFn: getVisitorCountByPurpose,
    queryKey: ["visitorPurpose"],
  });
  const { newData: purposeData } = purpose || {};

  const purposeChartConfig = {
    visitorPurpose: {
      label: "VisitorPurpose",
      color: "var(--chart-3)",
    },
    label: {
      color: "var(--background)",
    },
  };
  const YPurposeDataKey = "visitorPurpose";
  const xPurposeDataKey = "count";

  const chartConfig = {
    visitorType: {
      label: "VisitorType",
      color: "var(--chart-2)",
    },
    label: {
      color: "var(--background)",
    },
  };
  const YDataKey = "visitorType";
  const xDataKey = "count";

  return (
    <div className="flex flex-col space-y-4">
      <h2 className="text-lg font-semibold">Visitor Count by Type</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Visitor Type</CardTitle>
            <CardDescription>
              This chart shows the count of visitors by their type.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainerCategory
              chartData={newData}
              chartConfig={chartConfig}
              YDataKey={YDataKey}
              xDataKey={xDataKey}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Visitor Purpose</CardTitle>
            <CardDescription>
              This chart shows the count of visitors by their purpose.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainerCategory
              chartData={purposeData}
              chartConfig={purposeChartConfig}
              YDataKey={YPurposeDataKey}
              xDataKey={xPurposeDataKey}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export const ChartContainerCategory = memo(
  ({ chartData, YDataKey, xDataKey, chartConfig }) => {
    return (
      <ChartContainer config={chartConfig}>
        <BarChart
          accessibilityLayer
          data={chartData}
          layout="vertical"
          margin={{
            right: 16,
          }}
        >
          <CartesianGrid horizontal={false} />
          <YAxis
            dataKey={YDataKey}
            type="category"
            tickLine={false}
            tickMargin={10}
            axisLine={false}
            tickFormatter={(value) => value.slice(0, 3)}
            hide
          />
          <XAxis dataKey={xDataKey} type="number" hide />
          <ChartTooltip
            cursor={false}
            content={<ChartTooltipContent indicator="line" />}
          />
          <Bar
            dataKey={xDataKey}
            layout="vertical"
            fill={`var(--color-${YDataKey})`}
            radius={4}
          >
            <LabelList
              dataKey={YDataKey}
              position="insideLeft"
              offset={8}
              className="fill-(--color-label) capitalize"
              fontSize={12}
            />
            <LabelList
              dataKey={xDataKey}
              position="right"
              offset={8}
              className="fill-foreground"
              fontSize={12}
            />
          </Bar>
        </BarChart>
      </ChartContainer>
    );
  }
);
