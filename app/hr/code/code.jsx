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
import { cn } from "@/lib/utils";
import { QrCode } from "lucide-react";

export default function OfficeQRCode({ siteId, className }) {
  const [qrData, setQrData] = useState(""); // Data URL for QR
  const [tokenExpired, setTokenExpired] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const currentTokenRef = useRef("");
  const socketRef = useRef(null);

  useEffect(() => {
    socketRef.current = io(process.env.NEXT_PUBLIC_WEB_URL);

    socketRef.current.on("connect", () => {
      console.log("Office device connected");
    });

    socketRef.current.on("new-office-qr", async (payload) => {
      const token = typeof payload === "string" ? payload : payload?.token;
      const preRendered = typeof payload === "object" ? payload?.qrDataUrl : "";
      currentTokenRef.current = token || "";

      if (preRendered) {
        setQrData(preRendered);
      } else if (token) {
        const qrUrl = await QRCode.toDataURL(token);
        setQrData(qrUrl);
      } else {
        setQrData("");
      }

      setTokenExpired(false);
      setIsDialogOpen(true); // show dialog when QR generated
      console.log("Received new QR token:", token);
    });

    socketRef.current.on("office-qr-used", (token) => {
      if (token && currentTokenRef.current && token !== currentTokenRef.current)
        return;
      console.log("QR was used, removing:", token);
      setQrData("");
      setTokenExpired(true);
      setIsDialogOpen(false);
    });

    socketRef.current.on("office-qr-expired", (token) => {
      if (token && currentTokenRef.current && token !== currentTokenRef.current)
        return;
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
    currentTokenRef.current = "";
    setIsDialogOpen(true);
    socketRef.current.emit("generate-office-qr", { siteId });
  };

  return (
    <div>
      {/* Single Button */}
      <Button
        onClick={generateQRCode}
        className={cn(
          "h-12 text-base bg-indigo-600 hover:bg-indigo-700",
          className,
        )}
      >
        <QrCode />
        Request Code
      </Button>

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
