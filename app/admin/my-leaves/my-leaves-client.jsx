"use client";

import { CommonContext } from "@/context/commonContext";
import { EmployeeLeaveDeatails } from "@/app/admin/officeEmployee/components/employeeOtherDeatils";

export default function MyLeavesClient() {
  return (
    <CommonContext.Provider value={{ searchParams: [] }}>
      <EmployeeLeaveDeatails />
    </CommonContext.Provider>
  );
}
