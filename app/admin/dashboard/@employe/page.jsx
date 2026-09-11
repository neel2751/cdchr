import React from "react";
import EmployeCard from "../components/employe-card";
import AnnouncementsCard from "../components/announcementsCard";
import NotificationSetup from "@/components/notificationBanner";

export default async function Page({ searchParams }) {
  const param = await searchParams;
  return (
    <>
      <div className="p-4 mb-4">
        <NotificationSetup />
      </div>
      <div className="px-4 mb-4">
        <AnnouncementsCard />
      </div>
      <EmployeCard param={param} />
    </>
  );
}
