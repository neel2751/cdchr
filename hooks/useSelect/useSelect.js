"use client";

import {
  getSelectCompanies,
  getSelectFormTemplates,
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

export const useSelectFormTemplate = createSelectHook(getSelectFormTemplates, [
  "selectFormTemplate",
]);
