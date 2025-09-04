"use client";

import { useEffect, useState, useRef } from "react";
import { io } from "socket.io-client";
import QRCode from "qrcode";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import Image from "next/image";
import { Button } from "@/components/ui/button";

export default function OfficeQRCode({ siteId }) {
  const [qrData, setQrData] = useState(""); // Data URL for QR
  const [tokenExpired, setTokenExpired] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const socketRef = useRef(null);

  useEffect(() => {
    socketRef.current = io(process.env.NEXT_PUBLIC_WEB_URL);

    socketRef.current.on("connect", () => {
      console.log("Office device connected");
    });

    socketRef.current.on("new-office-qr", async (token) => {
      const qrUrl = await QRCode.toDataURL(token);
      setQrData(qrUrl);
      setTokenExpired(false);
      setIsDialogOpen(true); // show dialog when QR generated
      console.log("Received new QR token:", token);
    });

    socketRef.current.on("office-qr-used", (token) => {
      console.log("QR was used, removing:", token);
      setQrData("");
      setTokenExpired(true);
      setIsDialogOpen(false);
    });

    socketRef.current.on("office-qr-expired", (token) => {
      console.log("QR expired:", token);
      setQrData("");
      setTokenExpired(true);
      setIsDialogOpen(false);
    });

    return () => {
      socketRef.current.disconnect();
    };
  }, []);

  const generateQRCode = () => {
    setQrData("");
    setTokenExpired(false);
    setIsDialogOpen(true);
    socketRef.current.emit("generate-office-qr", { siteId });
  };

  return (
    <div>
      {/* Single Button */}
      <div className="mb-6">
        <Button
          onClick={generateQRCode}
          className="h-12 text-base bg-indigo-600 hover:bg-indigo-700"
        >
          Request Code
        </Button>
      </div>

      {/* QR Display Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="w-full sm:max-w-sm max-h-screen overflow-y-auto bg-white rounded-lg shadow-lg p-6">
          <DialogHeader>
            <DialogTitle>
              {tokenExpired ? "QR Code Expired" : "Scan to Continue"}
            </DialogTitle>
            <DialogDescription>
              {tokenExpired
                ? "The QR code has expired. Please generate a new one."
                : "Employees can scan this QR code to proceed and choose their action."}
            </DialogDescription>
          </DialogHeader>
          <div className="my-4 flex justify-center">
            {qrData && !tokenExpired ? (
              <Image
                src={qrData}
                alt="QR Code"
                width={250}
                height={250}
                className="w-60 h-60 object-contain"
              />
            ) : (
              <div className="w-48 h-48 bg-gray-200 flex items-center justify-center rounded-md">
                {tokenExpired ? "QR Expired" : "Click Request Code"}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              className="w-full bg-red-500 hover:bg-red-600"
              onClick={() => {
                setIsDialogOpen(false);
                setQrData("");
                setTokenExpired(false);
              }}
            >
              {tokenExpired ? "Close" : "Cancel"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
