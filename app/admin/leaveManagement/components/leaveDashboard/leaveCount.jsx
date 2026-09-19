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

/**
 * @param {object} props
 * @param {string} [props.slug] encrypted employee id — count this person only.
 * @param {string} [props.leaveYear] e.g. "2026-27" — count this year only.
 *
 * Both optional, and omitting them keeps the company overview exactly as it
 * was. Passing them is what makes the tiles above an employee's leave list
 * agree with the list: same person, same leave year.
 *
 * `undefined` and `null` mean different things for `slug`, deliberately.
 * Undefined is "this is the company overview". Null is "an employee page whose
 * id has not arrived yet" — it stays scoped and simply waits, rather than
 * falling back to company-wide figures for a moment on a personal page.
 */
const LeaveCount = ({ slug, leaveYear } = {}) => {
  const scoped = slug !== undefined;
  const { data: leaveCounts } = useFetchQuery({
    fetchFn: leaveCount,
    // The filters are in the key, or switching year would redisplay the
    // previous year's figures from cache.
    queryKey: scoped ? ["leaveCount", slug, leaveYear] : ["leaveCount"],
    params: scoped ? { slug, leaveYear } : undefined,
    enabled: !scoped || !!slug,
  });
  const { newData } = leaveCounts || {};
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
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
