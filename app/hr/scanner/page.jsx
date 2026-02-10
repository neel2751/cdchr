"use client";
import React, { useEffect, useRef } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { storeClockTime } from "@/server/2FAServer/qrcodeServer";
import { io } from "socket.io-client";
import { toast } from "sonner";

export default function ScannerModal({ siteId, open, onClose }) {
  const scannerRef = useRef(null);
  const socketRef = useRef(null);
  const audioRef = useRef(null);
  const errorAudioRef = React.useRef(null);
  React.useEffect(() => {
    audioRef.current = new Audio("/audio/beep.mp3");
    errorAudioRef.current = new Audio("/audio/error.mp3");
  }, []);

  const handleScan = async (decodedText) => {
    try {
      const response = await storeClockTime(decodedText, siteId);

      if (response.success) {
        toast.success("✅ Scan success");
        try {
          await audioRef.current?.play();
        } catch (err) {
          console.warn("Audio play error:", err);
        }

        if (!socketRef.current) {
          socketRef.current = io(process.env.NEXT_PUBLIC_WEB_URL);
        }
        socketRef.current.emit("stop-qr", response.employeeId);

        // ✅ Close immediately after success
        onClose?.();
      } else {
        toast.error(response.message || "❌ Error scanning QR!");
      }
    } catch (err) {
      console.log(err);
      toast.error("❌ Scan failed");
      try {
        await errorAudioRef.current?.play();
      } catch (err) {
        console.warn("Audio play error:", err);
      }
    }
  };

  useEffect(() => {
    if (!open) return;

    const scanner = new Html5Qrcode("qr-reader");
    scannerRef.current = scanner;

    scanner
      .start(
        { facingMode: "user" }, // back camera
        {
          fps: 60, // faster detection
          qrbox: (viewfinderWidth, viewfinderHeight) => {
            // take 80% of the smaller side
            const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
            return { width: minEdge * 0.9, height: minEdge * 0.9 };
          },
          aspectRatio: 1.0,
        },
        handleScan,
        () => {}
      )
      .catch((err) => console.log("Scanner start failed", err));

    return () => {
      scanner
        .stop()
        .then(() => {
          scanner.clear();
          scannerRef.current = null;
        })
        .catch(() => {});
    };
  }, [open]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div className="bg-white p-4 rounded-xl w-full max-w-2xl h-[80vh] relative">
        <button
          onClick={onClose}
          className="absolute top-2 right-2 text-gray-600 hover:text-black"
        >
          ✕
        </button>
        {/* Full height preview for faster detection */}
        <div id="qr-reader" className="w-full h-full" />
      </div>
    </div>
  );
}
