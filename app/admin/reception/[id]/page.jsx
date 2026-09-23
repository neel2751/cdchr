import React from "react";
import DeviceManagementSection from "../components/deviceManagement";
import { getReceptionUserById } from "@/server/receptionServer/receptionServer";

export default async function DeviceIdPage({ params }) {
  const { id } = await params;

  const officeUser = await getReceptionUserById(id);

  if (!officeUser?.success) {
    officeUser.data = null;
  }

  const parsed = officeUser?.data ? JSON.parse(officeUser.data) : null;

  if (!parsed) {
    return (
      <div className="p-4">
        <p className="text-sm text-neutral-500">
          That reception user could not be loaded.
        </p>
      </div>
    );
  }

  return (
    <div className="p-4 overflow-hidden w-full space-y-2">
      <div>
        <h2 className="text-xl font-semibold">{parsed.name}</h2>
        <p className="text-sm text-neutral-500">{parsed.email}</p>
      </div>
      <DeviceManagementSection officeUser={parsed} />
    </div>
  );
}
