import React from "react";
import EmployeCard from "../components/employe-card";
import NotificationSetup from "@/components/notificationBanner";

export default async function Page({ searchParams }) {
  const param = await searchParams;
  return (
    <>
      <div className="p-4 mb-4">
        <NotificationSetup />
      </div>
      <EmployeCard param={param} />
    </>
  );
}
