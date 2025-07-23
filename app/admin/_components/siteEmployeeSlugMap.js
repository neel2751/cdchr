"use client";
import SiteAttedanceData from "../employee/components/attedanceData";
import EmployeDocument from "../employee/components/employeDocument";
import { SiteEmployeeOtherDeatils } from "../employee/components/employeeOtherDeatils";
import ChnageSiteEmployeePassword from "../employee/components/employeePassword";

export const siteOfficeEmployeSlugComponentmap = {
  overview: SiteEmployeeOtherDeatils,
  attendance: SiteAttedanceData,
  document: EmployeDocument,
  password: ChnageSiteEmployeePassword,
};
