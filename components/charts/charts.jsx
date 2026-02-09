import { Card, CardContent } from "@/components/ui/card";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  PieChart,
  Pie,
  Cell,
  Legend,
  CartesianGrid,
  Line,
  Label,
} from "recharts";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "../ui/chart";
import { useEffect, useMemo, useState } from "react";

const COLORS = [
  "#8884d8",
  "#82ca9d",
  "#ffc658",
  "#ff8042",
  "#8dd1e1",
  "#a4de6c",
  "#d0ed57",
  "#ffc0cb",
];

export function ReusableBarChart({ data }) {
  return (
    <Card className="p-4">
      <CardContent className="h-[300px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="appName" tick={{ fontSize: 12 }} />
            <YAxis />
            <Tooltip />
            <Legend layout="horizontal" verticalAlign="bottom" align="center" />
            <Bar dataKey="totalInstalls" fill="#8884d8" />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

export function ReusableDonutChart({ data }) {
  return (
    <Card className="p-4">
      <CardContent className="h-[300px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="installPercentage"
              nameKey="appName"
              cx="50%"
              cy="50%"
              outerRadius={80}
              innerRadius={40}
              label={({ name, percent }) =>
                `${name} (${(percent * 100).toFixed(0)}%)`
              }
            >
              {data.map((entry, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={COLORS[index % COLORS.length]}
                />
              ))}
            </Pie>
            <Tooltip />
            <Legend layout="horizontal" verticalAlign="bottom" align="center" />
          </PieChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

// Usage Example:
// import { ReusableBarChart, ReusableDonutChart } from "./AppUsageCharts";
// <ReusableBarChart data={data} />
// <ReusableDonutChart data={data} />

const timeStringToHours = (timeStr) => {
  if (!timeStr) return 0;
  const [h, m] = timeStr.split(":").map(Number);
  return h + m / 60;
};

export function ReusableBarAttendanceChart({ data }) {
  // Convert data for chart
  const chartData = data.map((rec) => {
    const [th, tm] = rec.totalHours.split(":").map(Number);
    const [bh, bm] = rec.avgBreakHours.split(":").map(Number);

    return {
      date: new Date(rec.date).toLocaleDateString(), // or keep as YYYY-MM-DD
      totalHours: th + tm / 60, // Convert to decimal hours
      avgBreakHours: bh + bm / 60, // Convert to decimal hours
    };
  });
  return (
    <Card className={"sm:block hidden"}>
      <CardContent className="h-[350px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            accessibilityLayer
            data={chartData}
            margin={{ top: 20, right: 20, bottom: 20 }}
          >
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" tick={{ fontSize: 12 }} />
            <YAxis />
            <Tooltip
              formatter={(value) => `${value.toFixed(2)} hrs`}
              labelFormatter={(label) => `Date: ${label}`}
            />
            <Legend layout="horizontal" verticalAlign="bottom" align="center" />
            <Bar dataKey="totalHours" fill="#8884d8" name="Total Hours" />
            <Line
              type="monotone"
              dataKey="avgBreakHours"
              stroke="#FF8042"
              strokeWidth={2}
              name="Avg Break Hours"
            />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

export function ReusableReportChart({ data, dataKey, labelKey, config }) {
  return (
    <ChartContainer config={config} className="min-h-[300px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data}>
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis
            dataKey={labelKey}
            tickLine={false}
            tickMargin={10}
            axisLine={false}
          />
          <YAxis hide />
          <ChartTooltip content={<ChartTooltipContent />} />
          <Bar dataKey={dataKey} fill={`var(--color-${dataKey})`} radius={4} />
        </BarChart>
      </ResponsiveContainer>
    </ChartContainer>
  );
}

export function ReusablePieChart({ data, dataKey, nameKey, config }) {
  const totalValue = useMemo(() => {
    return data.reduce((sum, entry) => sum + (entry[dataKey] || 0), 0);
  }, [data, dataKey]);

  const [animatedTotal, setAnimatedTotal] = useState(0);

  useEffect(() => {
    let start = 0;
    const end = totalValue;
    if (start === end) return;

    const duration = 1000; // animation duration in ms
    const increment = end / (duration / 16); // assuming ~60fps

    const animate = () => {
      start += increment;
      if (start < end) {
        setAnimatedTotal(Math.floor(start));
        requestAnimationFrame(animate);
      } else {
        setAnimatedTotal(end);
      }
    };

    animate();
  }, [totalValue]);

  return (
    <ChartContainer
      config={config}
      className="mx-auto aspect-square max-h-[300px] relative w-full"
    >
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <ChartTooltip
            cursor={false}
            content={<ChartTooltipContent hideLabel />}
          />
          <Pie
            data={data}
            dataKey={dataKey}
            nameKey={nameKey}
            innerRadius={60} // Makes it a Donut Chart
            strokeWidth={5}
          >
            {/* {data.map((entry, index) => (
            <Cell
              key={`cell-${index}`}
              fill={entry.fill || COLORS[index % COLORS.length]}
            />
          ))} */}
          </Pie>
          <ChartLegend
            content={<ChartLegendContent nameKey={nameKey} />}
            className="-translate-y-2 flex-wrap gap-2 *:basis-1/4 *:justify-center"
          />
        </PieChart>
      </ResponsiveContainer>
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <span className="text-lg font-semibold">Total</span>
        <span className="text-2xl font-bold">
          {animatedTotal.toLocaleString()}
        </span>
      </div>
    </ChartContainer>
  );
}
