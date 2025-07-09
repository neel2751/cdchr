"use client";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import WeekRotaTable from "@/components/weekRotaTable/weekRotaTable";
import { useFetchQuery } from "@/hooks/use-query";
import { isObjectEqual } from "@/lib/object";
import { getWeeklyRotaForSuperAdmin } from "@/server/weeklyRotaServer/weeklyRotaServer";
import { format, parseISO } from "date-fns";
import {
  CalendarClock,
  CalendarDays,
  CheckCheck,
  ChevronDown,
  Loader2,
  User,
} from "lucide-react";
import React, { useState } from "react";
import AddCategory from "./components/addCategory";
import { PaginationWithLinks } from "@/components/pagination/pagination";
import { AddWeeklyRota } from "./addRota";

const Rota = ({ searchParams }) => {
  const currentPage = parseInt(searchParams?.page || "1");
  const pagePerData = parseInt(searchParams?.pageSize || "10");
  const queryKey = ["weekRotaSuperAdmin", { currentPage, pagePerData }];
  const {
    data: queryData,
    isLoading,
    isError,
  } = useFetchQuery({
    params: {
      page: currentPage,
      pageSize: pagePerData,
    },
    queryKey,
    fetchFn: getWeeklyRotaForSuperAdmin,
  });

  const [isOpen, setIsOpen] = useState();
  const { newData, totalCount } = queryData || {};
  //   const memoizedSchedules = useMemo(() => newData, [newData]);
  const [schedules, setSchedules] = useState([]);
  const handleOpen = (data) => {
    const isEqual = isObjectEqual(data?.attendanceData, schedules);
    if (isEqual) {
      setIsOpen();
      setSchedules([]);
    } else {
      setIsOpen(data?.weekStartDate);
      setSchedules(data?.attendanceData);
    }
  };

  return (
    <div className="p-4">
      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <div>
              <CardTitle>Weekly schedule</CardTitle>
              <CardDescription>
                You can update and approve the schedule for the week .
              </CardDescription>
            </div>
            <div className="inline-flex gap-2">
              <AddWeeklyRota />
              <AddCategory />
            </div>
          </div>
        </CardHeader>
        {isLoading ? (
          <div className="h-20 w-full flex justify-center items-center">
            <Loader2 className="size-10 animate-spin text-neutral-500 text-center w-full" />
          </div>
        ) : (
          <CardContent>
            {newData &&
              newData?.map((item) => (
                <Collapsible
                  open={isOpen === item?.weekStartDate}
                  onOpenChange={() => handleOpen(item)}
                  key={item?.weekStartDate}
                  className="mb-4"
                >
                  <CollapsibleTrigger
                    className={`w-full py-4 px-6 border-x border-t rounded-t-lg`}
                  >
                    <div className="flex items-center justify-between w-full">
                      <div className="flex items-center gap-4">
                        <CardTitle className="flex flex-col items-start gap-2">
                          Week of{" "}
                          {format(
                            parseISO(item?.weekStartDate),
                            "MMMM d, yyyy"
                          )}
                          <Badge
                            variant="outline"
                            className={`border-none flex-col items-start gap-1 text-indigo-600 p-0`}
                          >
                            <div className="flex gap-2">
                              <span className="inline-flex gap-2">
                                <CheckCheck className="w-4 h-4" />
                                {item?.approvedStatus} (
                                {item?.approvedCount || 0})
                              </span>
                              <span className="inline-flex gap-2">
                                <User className="w-4 h-4" />
                                {item?.result?.employeeName}
                              </span>
                              <span className="inline-flex gap-2">
                                <CalendarDays className="w-4 h-4" />
                                {format(item?.submitDate || new Date(), "PPP")}
                              </span>
                              <span className="inline-flex gap-2">
                                <CalendarClock className="w-4 h-4" />
                                {format(
                                  item?.approvedDate || new Date(),
                                  "PPP"
                                )}
                              </span>
                            </div>
                          </Badge>
                        </CardTitle>
                      </div>
                      <ChevronDown className="h-5 w-5" />
                    </div>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="border-x border-b rounded-b-lg">
                    <CardContent>
                      <WeekRotaTable
                        isLoading={isLoading}
                        currentWeek={item?.weekStartDate}
                        schedules={schedules}
                        setSchedules={setSchedules}
                        queryKey={queryKey}
                        memoizedSchedules={{
                          weekId: item._id,
                        }}
                      />
                    </CardContent>
                  </CollapsibleContent>
                </Collapsible>
              ))}
            {totalCount > 10 && (
              <PaginationWithLinks
                pageSize={pagePerData}
                totalCount={totalCount || 0}
                page={currentPage}
                pageSizeSelectOptions={{
                  pageSizeOptions: [10, 20, 30, 40],
                }}
              />
            )}
          </CardContent>
        )}
      </Card>
    </div>
  );
};

export default Rota;
