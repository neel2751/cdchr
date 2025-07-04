"use client";

import { getSelectLeaveCategories } from "@/server/selectServer/selectServer";
import { useFetchSelectQuery } from "../use-query";

export function useSelectAllLeaveCategories() {
  const { data: leaveTypes = [] } = useFetchSelectQuery({
    queryKey: ["leave-types"],
    fetchFn: getSelectLeaveCategories,
  });
  return leaveTypes;
}
