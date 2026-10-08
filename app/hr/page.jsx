"use client";
import React from "react";
import HandleVisitor from "../admin/visitors/handleVisitor";
import { Button } from "@/components/ui/button";
import { CardDescription, CardTitle } from "@/components/ui/card";
import OfficeQRCode from "./code/code";
import Image from "next/image";

export default function page() {
  // we have to show two big boxes first one Add visitors and second one Attendance with images
  const [open, setOpen] = React.useState(false);
  return (
    <div className="p-4 space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white p-6 rounded-lg shadow-md hover:shadow-lg transition-shadow border border-gray-200">
          <Image
            src="/images/feedback.svg"
            alt="Add Visitor"
            width={400}
            height={300}
            title="Add a new visitor to the system"
            className="w-full object-cover rounded-lg mb-4"
          />
          <div className="space-y-2">
            <CardTitle>Add Visitor</CardTitle>
            <CardDescription className="text-gray-600">
              Register a new visitor by providing their details. Ensure all
              information is accurate before submission.
            </CardDescription>
          </div>
          <Button
            onClick={() => setOpen(true)}
            className="h-12 text-base bg-indigo-600 hover:bg-indigo-700 mt-6"
          >
            Add Visitor
          </Button>
        </div>
        <div className="bg-white p-6 rounded-lg shadow-md hover:shadow-lg transition-shadow border border-gray-200">
          <Image
            src="/images/welcome.svg"
            alt="Attendance"
            width={400}
            height={300}
            title="Scan QR Code to mark your attendance"
            className="w-full object-cover rounded-lg mb-4"
          />
          <div className="space-y-2 mb-4">
            <CardTitle>Attendance</CardTitle>
            <CardDescription>
              Scan the QR code to mark your attendance. Ensure you are logged in
              to your account.
            </CardDescription>
          </div>
          <div className="mb-6">
            <OfficeQRCode />
          </div>
        </div>
      </div>
      <HandleVisitor open={open} onOpenChange={setOpen} />
      {/* <Calendar mode="multiple" className="w-full md:w-1/2 lg:w-1/3" /> */}
      {/* <ConsultationBooking /> */}
    </div>
  );
}
