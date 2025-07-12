"use client";

import {
  getSelectCompanies,
  getSelectLeaveCategories,
  getSelectProjects,
} from "@/server/selectServer/selectServer";
import { useFetchSelectQuery } from "../use-query";
import { createSelectHook } from "./useSelectHook";

export function useSelectAllLeaveCategories() {
  const { data: leaveTypes = [] } = useFetchSelectQuery({
    queryKey: ["leave-types"],
    fetchFn: getSelectLeaveCategories,
  });
  return leaveTypes;
}

export const useSelectCompany = createSelectHook(getSelectCompanies, [
  "selectCompany",
]);

export const useSelectSiteProject = createSelectHook(getSelectProjects, [
  "selectSiteProject",
]);
