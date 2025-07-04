"use client";
import React from "react";
import { Html5QrcodeScanner } from "html5-qrcode";
import { storeClockTime } from "@/server/2FAServer/qrcodeServer";
import { toast } from "sonner";
import "./scan-box.css";
import { io } from "socket.io-client";
import { Loader2Icon } from "lucide-react";

export default function ScanQrcode({ siteId }) {
  const [scanning, setScanning] = React.useState(true);
  const scannerRef = React.useRef(null);
  const alreadyScannedRef = React.useRef(false);
  const audioRef = React.useRef(null);
  const errorAudioRef = React.useRef(null);
  const socketRef = React.useRef(null);

  React.useEffect(() => {
    audioRef.current = new Audio("/audio/beep.mp3");
    errorAudioRef.current = new Audio("/audio/error.mp3");
  }, []);

  const handleScan = async (token) => {
    if (!scanning || alreadyScannedRef.current) {
      toast.warning("⏳ Please wait, processing...");
      return;
    }
    alreadyScannedRef.current = true;
    setScanning(false);

    try {
      const response = await storeClockTime(token, siteId);
      if (response.success) {
        toast.success(response.message || "✅ QR Code scanned successfully!");

        if (!socketRef.current) {
          socketRef.current = io(process.env.NEXT_PUBLIC_WEB_URL);
          socketRef.current.on("connect", () => {
            console.log("Socket connected (scan side):", socketRef.current.id);
            if (response.employeeId) {
              socketRef.current.emit("stop-qr", response.employeeId);
            }
          });
        } else if (socketRef.current.connected) {
          socketRef.current.emit("stop-qr", response.employeeId);
        } else {
          socketRef.current.on("connect", () => {
            socketRef.current.emit("stop-qr", response.employeeId);
          });
        }

        try {
          await audioRef.current?.play();
        } catch (err) {
          console.warn("Audio play error:", err);
        }
      } else {
        toast.error(response.message || "❌ Error scanning QR!");
        try {
          await errorAudioRef.current?.play();
        } catch (err) {
          console.warn("Audio play error:", err);
        }
      }
    } catch (error) {
      console.error("Error verifying token:", error);
      toast.error("❌ Error scanning QR!");
    }

    setTimeout(() => {
      alreadyScannedRef.current = false;
      setScanning(true);
    }, 5000);
  };

  React.useEffect(() => {
    if (typeof window === "undefined" || scannerRef.current) return;

    const scanner = new Html5QrcodeScanner("qr-reader", {
      fps: 10,
      qrbox: 250,
    });

    scanner.render(
      (decodedText) => handleScan(decodedText),
      (error) => {}
    );

    scannerRef.current = scanner;

    return () => {
      scanner.clear().catch(() => {});
      const el = document.getElementById("qr-reader");
      if (el) el.innerHTML = ""; // <-- Manually clear the container!
      scannerRef.current = null;
    };
  }, []);

  return (
    <div className="w-full max-w-md max-h-max h-96 mx-auto">
      <div id="qr-reader" />
      {!scanning && (
        <div className="flex justify-center mt-4">
          <Loader2Icon className="animate-spin text-blue-500" />
        </div>
      )}
    </div>
  );
}
