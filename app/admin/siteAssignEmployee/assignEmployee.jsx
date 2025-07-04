"use client";
import EmployeeSiteManagement from "./test";
import { CommonContext } from "@/context/commonContext";

export default function AssignEmployee({ searchParams }) {
  return (
    <div className="overflow-x-scroll p-6">
      <CommonContext.Provider value={{ filter: searchParams }}>
        <EmployeeSiteManagement />
      </CommonContext.Provider>
    </div>
  );
}
