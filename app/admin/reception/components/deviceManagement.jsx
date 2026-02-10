"use client";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  addDevice,
  revokeDevice,
  toggleDeviceLock,
} from "@/server/deviceServer/deviceManagementServer";
import { useRouter } from "next/navigation";
import React, { useState } from "react";
import { toast } from "sonner";

const DeviceManagementSection = ({ officeUser }) => {
  const [newDeviceId, setNewDeviceId] = useState("");
  const [newDeviceName, setNewDeviceName] = useState("");
  const router = useRouter();

  const onUpdate = () => {
    router.refresh();
  };

  const handleAddDevice = async () => {
    if (!newDeviceId) return alert("Please enter a Device ID");
    // This calls your backend API to add the device to the array
    const response = await addDevice({
      userId: officeUser._id,
      deviceId: newDeviceId,
      deviceName: newDeviceName,
    });
    if (response.success) {
      toast.success("Device added successfully.");
      setNewDeviceId("");
      setNewDeviceName("");
      onUpdate(); // Refresh the data
    }
  };

  const handleRevoke = async (deviceId) => {
    try {
      const response = await revokeDevice({
        userId: officeUser._id,
        deviceId,
      });
      if (response.success) {
        toast.success("Device revoked successfully.");
        onUpdate(); // Refresh the data
      }
    } catch (error) {
      console.log("Error revoking device:", error);
      toast.error("Failed to revoke device.");
    }
  };

  const handleSwitchToggle = async () => {
    try {
      const response = await toggleDeviceLock({
        userId: officeUser._id,
        isEnabled: !officeUser.enforceDeviceLock,
      });
      if (response.success) {
        toast.success(
          `Device Lock ${
            !officeUser.enforceDeviceLock ? "enabled" : "disabled"
          } successfully.`
        );
        onUpdate(); // Refresh the data
      }
    } catch (error) {
      console.log("Error toggling device lock:", error);
      toast.error("Failed to toggle device lock.");
    }
  };

  return (
    <div className="bg-white p-6 rounded-lg shadow-md border mt-6">
      <h3 className="text-lg font-bold text-gray-800 mb-4">
        Hardware Security (Device Lock)
      </h3>

      {/* 1. Toggle Master Switch */}
      <div className="flex items-center mb-6">
        <span className="mr-3 font-medium">Enforce Device Lock:</span>
        <Button
          className={`px-4 py-1 rounded ${
            officeUser?.enforceDeviceLock
              ? "bg-green-600 text-white"
              : "bg-gray-300"
          }`}
          onClick={handleSwitchToggle}
        >
          {officeUser?.enforceDeviceLock ? "ON" : "OFF"}
        </Button>
      </div>

      {/* 2. Table of Authorized Devices */}
      <Table className="w-full mb-6 border-collapse">
        <TableHeader>
          <TableRow className="bg-gray-50 border-b">
            <TableHead className="p-2 text-left">Device Name</TableHead>
            <TableHead className="p-2 text-left">
              Hardware ID (Fingerprint)
            </TableHead>
            <TableHead className="p-2 text-center">Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {officeUser?.authorizedDevices?.map((device) => (
            <TableRow
              key={device?.deviceId}
              className="border-b hover:bg-gray-50"
            >
              <TableCell className="p-2">{device.deviceName}</TableCell>
              <TableCell className="p-2 font-mono text-sm text-blue-600">
                {device?.deviceId}
              </TableCell>
              <TableCell className="p-2 text-center">
                <Button
                  variant={"outline"}
                  className="text-red-500 hover:bg-red-100 hover:text-red-600 cursor-pointer"
                  onClick={() => handleRevoke(device.deviceId)}
                >
                  Revoke
                </Button>
              </TableCell>
            </TableRow>
          ))}
          {officeUser?.authorizedDevices?.length === 0 && (
            <TableRow>
              <TableCell
                colSpan="3"
                className="p-4 text-center text-gray-500 italic"
              >
                No devices authorized yet.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      {/* 3. Add New Device Form */}
      <Card className="bg-gray-50">
        <CardHeader>
          <CardTitle>Add New Authorized Device</CardTitle>
          <CardDescription>
            To authorize a new device, enter its name and hardware ID below.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col md:flex-row gap-3">
            <Input
              className="border p-2 rounded flex-1"
              placeholder="Device Name (e.g. London Main Tablet)"
              value={newDeviceName}
              onChange={(e) => setNewDeviceName(e.target.value)}
            />
            <Input
              className="border p-2 rounded flex-1 font-mono"
              placeholder="Paste Hardware ID here..."
              value={newDeviceId}
              onChange={(e) => setNewDeviceId(e.target.value)}
            />
            <Button
              onClick={handleAddDevice}
              className="bg-green-600 text-white rounded hover:bg-green-700"
            >
              Authorize
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default DeviceManagementSection;
