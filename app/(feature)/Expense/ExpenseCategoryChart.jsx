"use client";
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  XAxis,
  YAxis,
} from "recharts";

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { memo, useEffect, useState } from "react";
import { fetchAllExpensesWithCategory } from "@/actions/siteExpenseAction/siteExpenseAction";

const chartConfig = {
  totalAmount: {
    label: "TotalAmount",
    color: "hsl(var(--chart-2))",
  },
  label: {
    color: "hsl(var(--background))",
  },
};

export const ExpenseCategoryChart = memo(function ExpenseCategoryChart() {
  const [chartData, setChartData] = useState([]);
  const fetchData = async () => {
    try {
      const response = await fetchAllExpensesWithCategory();
      if (response.status) {
        const data = JSON.parse(response?.data);
        console.log(data);
        setChartData(data);
      }
    } catch (error) {
      console.error(error);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  return (
    <div className="w-full">
      <Card>
        <CardHeader>
          <CardTitle>Expense Category</CardTitle>
          <CardDescription>
            January - June {new Date().getFullYear()}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ChartContainerCategory chartData={chartData} />
        </CardContent>
        <CardFooter className="flex-col items-start gap-2 text-sm">
          <div className="flex gap-2 font-medium leading-none">
            All expense category with total amount
          </div>
          <div className="leading-none text-muted-foreground">
            Showing only category who is used in
          </div>
        </CardFooter>
      </Card>
    </div>
  );
});

export const ChartContainerCategory = memo(({ chartData }) => {
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
          dataKey="categoryName"
          type="category"
          tickLine={false}
          tickMargin={10}
          axisLine={false}
          tickFormatter={(value) => value.slice(0, 3)}
          hide
        />
        <XAxis dataKey="totalAmount" type="number" hide />
        <ChartTooltip
          cursor={false}
          content={<ChartTooltipContent indicator="line" />}
        />
        <Bar
          dataKey="totalAmount"
          layout="vertical"
          fill="var(--color-totalAmount)"
          radius={4}
        >
          <LabelList
            dataKey="categoryName"
            position="insideLeft"
            offset={8}
            className="fill-[--color-label]"
            fontSize={12}
          />
          <LabelList
            dataKey="totalAmount"
            position="right"
            offset={8}
            className="fill-foreground"
            fontSize={12}
          />
        </Bar>
      </BarChart>
    </ChartContainer>
  );
});
