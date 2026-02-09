import React from "react";
import DeviceManagementSection from "../components/deviceManagement";
import { getReceptionUserById } from "@/server/receptionServer/receptionServer";

export default async function DeviceIdPage({ params }) {
  const { id } = await params;

  const officeUser = await getReceptionUserById(id);

  if (!officeUser?.success) {
    officeUser.data = null;
  }

  return (
    <div className="p-4 overflow-hidden w-full">
      <DeviceManagementSection officeUser={JSON.parse(officeUser?.data)} />
    </div>
  );
}
