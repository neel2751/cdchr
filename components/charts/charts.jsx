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
} from "recharts";

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
