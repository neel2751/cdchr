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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useFetchSelectQuery } from "@/hooks/use-query";
import { getClockLocations } from "@/server/clockServer/locations";
import {
  addDevice,
  revokeDevice,
  setDeviceLocation,
  toggleDeviceLock,
} from "@/server/deviceServer/deviceManagementServer";
import { useRouter } from "next/navigation";
import React, { useState } from "react";
import { toast } from "sonner";

const DeviceManagementSection = ({ officeUser }) => {
  const [newDeviceId, setNewDeviceId] = useState("");
  const [newDeviceName, setNewDeviceName] = useState("");
  const [newDeviceLocation, setNewDeviceLocation] = useState("");
  const router = useRouter();

  // Offices only. A screen registered to a site would issue codes naming a job
  // rather than a place, and a site screen already knows where it is.
  const { data: locations = [] } = useFetchSelectQuery({
    queryKey: ["clockLocations"],
    fetchFn: getClockLocations,
  });
  const offices = locations.filter((l) => !l.projectSiteId);

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
      locationId: newDeviceLocation || null,
    });
    if (response.success) {
      toast.success("Device added successfully.");
      setNewDeviceId("");
      setNewDeviceName("");
      setNewDeviceLocation("");
      onUpdate(); // Refresh the data
    } else {
      toast.error(response?.message || "Could not add that device.");
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

  const handleLocationChange = async (deviceId, locationId) => {
    const response = await setDeviceLocation({
      userId: officeUser._id,
      deviceId,
      locationId: locationId === "__none" ? null : locationId,
    });
    if (response?.success) {
      toast.success(response.message);
      onUpdate();
    } else {
      toast.error(response?.message || "Could not set the location.");
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
      <h3 className="text-lg font-bold text-gray-800 mb-1">
        Screens &amp; devices
      </h3>
      {/* The instructions were the missing half of this feature: the hardware
          ID is computed in the reception browser, so an administrator sitting
          at a different machine had no way to discover what to paste. */}
      <div className="mb-5 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
        <p className="font-medium">Registering a reception screen</p>
        <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-xs">
          <li>
            On the reception device itself, sign in and open the attendance
            screen. It shows its own <strong>Screen ID</strong> with a Copy
            button.
          </li>
          <li>Paste that ID below, name the screen, and choose its office.</li>
          <li>
            From then on codes from that screen record attendance at that
            office, and nobody at the desk is asked to choose.
          </li>
        </ol>
        <p className="mt-2 text-xs">
          A screen left on <em>Ask each time</em> still works — it asks the
          person standing at it, and remembers the answer in that browser only.
        </p>
      </div>

      {/* 1. Toggle Master Switch */}
      <div className="flex items-center mb-6">
        <span className="mr-3 font-medium">
          Enforce Device Lock (sign-in limited to these devices):
        </span>
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
            <TableHead className="p-2 text-left">Clocks in at</TableHead>
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
              <TableCell className="p-2">
                <Select
                  value={device?.locationId ? String(device.locationId) : "__none"}
                  onValueChange={(v) => handleLocationChange(device.deviceId, v)}
                >
                  <SelectTrigger className="w-52">
                    <SelectValue placeholder="Ask each time" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">Ask each time</SelectItem>
                    {offices.map((o) => (
                      <SelectItem key={o._id} value={o._id}>
                        {o.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
                colSpan="4"
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
            Registering it to an office means codes from that screen record
            attendance there, without anyone at the desk having to choose.
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
            <Select
              value={newDeviceLocation || "__none"}
              onValueChange={(v) =>
                setNewDeviceLocation(v === "__none" ? "" : v)
              }
            >
              <SelectTrigger className="flex-1">
                <SelectValue placeholder="Ask each time" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">Ask each time</SelectItem>
                {offices.map((o) => (
                  <SelectItem key={o._id} value={o._id}>
                    {o.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
