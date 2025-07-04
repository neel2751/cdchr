import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useFetchQuery } from "@/hooks/use-query";
import { leaveCount } from "@/server/leaveServer/leaveDash";
import {
  BadgeAlert,
  BadgeCheck,
  BadgeX,
  CalendarOff,
  Goal,
} from "lucide-react";
import React from "react";

const LeaveCount = () => {
  const { data: leaveCounts } = useFetchQuery({
    fetchFn: leaveCount,
    queryKey: ["leaveCount"],
  });
  const { newData } = leaveCounts || {};
  return (
    <div className=" grid grid-cols-5 gap-4">
      {newData &&
        newData.map((item, idx) => (
          <LeaveCard key={idx} label={item?.label} value={item?.value} />
        ))}
    </div>
  );
};

export default LeaveCount;

export const LeaveCard = ({ label, value }) => (
  <Card className="w-full">
    <CardHeader className="flex flex-row justify-between items-start">
      <div className="space-y-2">
        <CardTitle>{value}</CardTitle>
        <CardDescription>{label}</CardDescription>
      </div>
      {label === "Total" ? (
        <Goal className="text-indigo-600 size-5" />
      ) : label === "Pending" ? (
        <BadgeAlert className="text-amber-600 size-5" />
      ) : label === "Approved" ? (
        <BadgeCheck className="text-green-600 size-5" />
      ) : label === "Rejected" ? (
        <BadgeX className="text-red-600 size-5" />
      ) : (
        <CalendarOff className="text-gray-500 size-5" />
      )}
    </CardHeader>
  </Card>
);
