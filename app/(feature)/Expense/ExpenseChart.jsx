import { getExpenseMonthWiseTotal } from "@/actions/siteExpenseAction/siteExpenseAction";
import React, { memo, useCallback, useEffect, useState } from "react";
import { BarChartMonth } from "@/components/Chart/BarChartLabel";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Searchbox } from "@/components/SearchBox";
import { RefreshCcw } from "lucide-react";
import { FetchExpenseCategory } from "./ExpenseCategory";
import { toast } from "react-toastify";

const ExpenseChart = memo(() => {
  const { category } = FetchExpenseCategory();
  const [filterCategory, setFilterCategory] = useState("");
  const [chartData, setChartData] = useState();
  const [refresh, setRefresh] = useState(false);
  const filterCat = useCallback(async () => {
    try {
      const response = await getExpenseMonthWiseTotal(filterCategory);
      if (response) {
        const data = JSON.parse(response);
        setChartData(data);
      } else {
        toast.warn(" No data found");
      }
    } catch (error) {
      console.error(error);
    }
  }, [filterCategory, refresh]);
  useEffect(() => {
    filterCat();
  }, [filterCategory, refresh]);

  const chartConfig = {
    totalExpense: {
      label: "TotalExpense",
      color: "hsl(var(--chart-4))",
      radius: [0, 0, 4, 4],
    },
    averageExpense: {
      label: "AverageExpense",
      color: "hsl(var(--chart-2))",
      radius: [4, 4, 0, 0],
    },
  };
  return (
    <div className="w-full">
      {chartData && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Month Wise</CardTitle>
              <div className="max-w-max flex items-center gap-2">
                <Searchbox
                  value={filterCategory === "" ? "all" : filterCategory}
                  onChange={(e) =>
                    setFilterCategory(() => (e === "all" ? "" : e))
                  }
                  placeholder={"Search Category"}
                  frameworks={[
                    { _id: "all", categoryName: "All" },
                    ...category,
                  ].map((cat) => ({
                    value: cat._id,
                    label: cat.categoryName,
                  }))}
                />
                <div
                  onClick={() => setRefresh(!refresh)}
                  className="bg-neutral-100 rounded-md p-2 hover:bg-gray-200 transition-all duration-200 ease-in-out cursor-pointer group relative"
                >
                  <RefreshCcw className="size-4 text-neutral-600 rounded-md" />
                  <span className="group-hover:block whitespace-nowrap hidden absolute -right-1/2 bottom-10 bg-sky-600 text-white text-xs py-1 px-2 overflow-visible rounded-md max-w-max">
                    {/*  set the tip for refresh button  */}
                    Refresh Chart
                  </span>
                  <span className="group-hover:block hidden absolute -right-1/2 top-10 bg-amber-600 text-white text-xs py-1 px-2 overflow-visible rounded-md max-w-max whitespace-nowrap">
                    warning: Don't refresh every time
                  </span>
                </div>
              </div>
            </div>
            <CardDescription>
              <div className="flex gap-2">
                <div>
                  Total:{" "}
                  <span className="text-green-600 font-medium">
                    £{chartData.grandTotal.toFixed(2)}
                  </span>
                </div>
                <div>
                  Avgtotal:{" "}
                  <span className="text-green-600 font-medium">
                    £{chartData?.overallAverageExpense.toFixed(2)}
                  </span>
                </div>
              </div>
              January - December {new Date().getFullYear()}{" "}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <BarChartMonth
              chartData={chartData.monthlyExpenses}
              chartConfig={chartConfig}
            />
          </CardContent>
          <CardFooter className="flex-col items-start gap-2 text-sm">
            <div className="leading-none text-muted-foreground">
              Showing{" "}
              <span className="text-green-600 font-semibold text-sm">
                {filterCategory
                  ? category.map((item) => {
                      if (item._id === filterCategory) {
                        return item.categoryName;
                      }
                    })
                  : "All"}
              </span>{" "}
              category total & avarage expense for this year
            </div>
          </CardFooter>
        </Card>
      )}
    </div>
  );
});

export default ExpenseChart;
