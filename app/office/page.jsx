"use client";
import React from "react";
import HandleVisitor from "../admin/visitors/handleVisitor";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { CardDescription, CardTitle } from "@/components/ui/card";
import ScannerModal from "./scanner/page";

export default function page() {
  // we have to show two big boxes first one Add visitors and second one Attendance with images
  const [open, setOpen] = React.useState(false);
  return (
    <div className="p-4 space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white p-6 rounded-lg shadow-md hover:shadow-lg transition-shadow border border-gray-200">
          <img
            src="/images/feedback.svg"
            alt="Add Visitor"
            className="w-full object-cover rounded-lg mb-4"
          />
          <div className="space-y-2">
            <CardTitle>Add Visitor</CardTitle>
            <CardDescription className="text-gray-600">
              Please add a request for a visitor to enter the office premises.
            </CardDescription>
          </div>
          <Button
            onClick={() => setOpen(true)}
            className="mt-4 bg-blue-500 text-white rounded hover:bg-blue-600"
          >
            Add Visitor
          </Button>
        </div>
        <div className="bg-white p-6 rounded-lg shadow-md hover:shadow-lg transition-shadow border border-gray-200">
          <img
            src="/images/welcome.svg"
            alt="Attendance"
            className="w-full object-cover rounded-lg mb-4"
          />
          <div className="space-y-2">
            <CardTitle>Attendance</CardTitle>
            <CardDescription>
              Scan the QR code to mark your attendance. Ensure you are logged in
              to your account.
            </CardDescription>
          </div>
          <ScanQrcodeComponent />
        </div>
      </div>
      <HandleVisitor open={open} onOpenChange={setOpen} />
    </div>
  );
}

function ScanQrcodeComponent() {
  // const openScanner = () => {
  //   const width = 400;
  //   const height = 600;
  //   const left = window.screenX + (window.innerWidth - width) / 2;
  //   const top = window.screenY + (window.innerHeight - height) / 2;

  //   const scannerWindow = window.open(
  //     `/office/scanner`,
  //     "_blank",
  //     `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes,status=yes`
  //   );

  //   const handleMessage = (e) => {
  //     if (e.data?.type === "QR_SCANNED") {
  //       console.log("Scanned token:", e.data.token);
  //       console.log("Employee ID:", e.data.employeeId);
  //       window.removeEventListener("message", handleMessage);

  //       // Optional: update UI or toast
  //       toast.success("QR Code scanned successfully!");
  //     }
  //   };

  //   window.addEventListener("message", handleMessage);
  // };

  const [open, setOpen] = React.useState(false);

  return (
    <div>
      <Button
        // onClick={openScanner}
        onClick={() => setOpen(true)}
        className="mt-4 bg-blue-500 text-white rounded hover:bg-blue-600"
      >
        Scan QR Code
      </Button>
      <ScannerModal open={open} onClose={() => setOpen(false)} />
    </div>
  );
}
