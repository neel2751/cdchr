"use client";
import React, { useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";

export default function HowQRWork() {
  const steps = [
    {
      title: "Generate QR Code",
      description:
        "Click on the clock in button to generate a QR code. Use your mobile device to scan the QR code displayed on the screen.",
    },
    {
      title: "Scan the QR Code",
      description:
        "Use the office device to scan the QR code. This will log your clock in time and start your work session.",
    },
    {
      title: "Clock In Confirmation",
      description:
        "Once the QR code is scanned, you will receive a confirmation message indicating that you have successfully clocked in.",
    },
    {
      title: "Clock Out",
      description:
        "At the end of your work session, click on the clock out button to generate a new QR code. Scan this code with the office device to log your clock out time.",
    },
    {
      title: "Breaks",
      description:
        "You can also use the QR code to log breaks. Click on the break in or break out button to generate a QR code for logging breaks.",
    },
  ];

  const [open, setOpen] = React.useState(true);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const storedOpenState = localStorage.getItem("howQRWork");
      if (storedOpenState === "true") {
        setOpen(false);
      } else {
        setOpen(true);
      }
    }
  }, []);

  const handleClose = () => {
    setOpen(false);
    localStorage.setItem("howQRWork", "true");
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold">
            How QR Code Works
          </DialogTitle>
          <DialogDescription>
            Scan the QR code when you reach the office to clock in, clock out,
            take breaks, and resume work. Each action is recorded in the system
            for accurate attendance tracking.
          </DialogDescription>
          <ol className="list-decimal list-inside space-y-2 mt-4">
            {steps.map((step, index) => (
              <li key={index} className="text-sm text-gray-600">
                <strong>{step.title}:</strong> {step.description}
              </li>
            ))}
          </ol>
        </DialogHeader>
      </DialogContent>
    </Dialog>
  );
}
