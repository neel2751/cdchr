// "use client";
// import React, { useEffect, useRef } from "react";
// import { Html5QrcodeScanner } from "html5-qrcode";
// import { storeClockTime } from "@/server/2FAServer/qrcodeServer";
// import { io } from "socket.io-client";
// import "../../../components/2FA/scan-box.css";

// export default function ScannerPage() {
//   const scannerRef = useRef(null);
//   const audioRef = useRef(null);
//   const errorAudioRef = useRef(null);
//   const socketRef = useRef(null);
//   const alreadyScannedRef = useRef(false);

//   useEffect(() => {
//     audioRef.current = new Audio("/audio/beep.mp3");
//     errorAudioRef.current = new Audio("/audio/error.mp3");

//     socketRef.current = io(process.env.NEXT_PUBLIC_WEB_URL);

//     const scanner = new Html5QrcodeScanner("qr-reader", {
//       fps: 10,
//       qrbox: 400,
//     });

//     scanner.render(
//       async (decodedText) => {
//         if (alreadyScannedRef.current) return;
//         alreadyScannedRef.current = true;

//         try {
//           const response = await storeClockTime(decodedText);

//           if (response.success) {
//             try {
//               await audioRef.current?.play();
//             } catch {}
//             if (response.employeeId)
//               socketRef.current.emit("stop-qr", response.employeeId);

//             // Notify main window
//             if (window.opener && !window.opener.closed) {
//               window.opener.postMessage(
//                 {
//                   type: "QR_SCANNED",
//                   token: decodedText,
//                   employeeId: response.employeeId,
//                 },
//                 "*"
//               );
//             }

//             setTimeout(() => window.close(), 500); // Close tab after a short delay
//           } else {
//             alert(response.message || "Error storing scan!");
//             try {
//               await errorAudioRef.current?.play();
//             } catch {}
//             alreadyScannedRef.current = false;
//           }
//         } catch (err) {
//           console.error(err);
//           alert("Error storing scan! Please retry.");
//           alreadyScannedRef.current = false;
//         }
//       },
//       (error) => {
//         // optional scan error logging
//         console.warn("Scan error:", error);
//       }
//     );

//     scannerRef.current = scanner;

//     return () => {
//       scanner.clear().catch(() => {});
//       scannerRef.current = null;
//     };
//   }, []);

//   return <div id="qr-reader" className="w-full h-full" />;
// }

"use client";
import React, { useEffect, useRef, useState } from "react";
import { Html5QrcodeScanner } from "html5-qrcode";
import { storeClockTime } from "@/server/2FAServer/qrcodeServer";
import { io } from "socket.io-client";
import { Loader2Icon } from "lucide-react";
import { toast } from "sonner";

export default function ScannerModal({ siteId, open, onClose }) {
  const scannerRef = useRef(null);
  const alreadyScannedRef = useRef(false);
  const [scanning, setScanning] = useState(true);
  const socketRef = useRef(null);
  const audioRef = useRef(null);
  const errorAudioRef = useRef(null);

  useEffect(() => {
    audioRef.current = new Audio("/audio/beep.mp3");
    errorAudioRef.current = new Audio("/audio/error.mp3");
  }, []);

  const handleScan = async (token) => {
    if (!scanning || alreadyScannedRef.current) return;

    alreadyScannedRef.current = true;
    setScanning(false);

    try {
      const response = await storeClockTime(token, siteId);

      if (response.success) {
        toast.success("✅ Scan success");

        // emit socket event
        if (!socketRef.current) {
          socketRef.current = io(process.env.NEXT_PUBLIC_WEB_URL);
        }
        socketRef.current.emit("stop-qr", response.employeeId);

        await audioRef.current?.play();
      } else {
        toast.error(response.message || "❌ Error scanning QR!");
        await errorAudioRef.current?.play();
      }
    } catch (err) {
      console.error(err);
      toast.error("❌ Scan failed");
      await errorAudioRef.current?.play();
    }

    // Reset after 3s
    setTimeout(() => {
      alreadyScannedRef.current = false;
      setScanning(true);
    }, 3000);
  };

  useEffect(() => {
    if (open && !scannerRef.current) {
      const scanner = new Html5QrcodeScanner("qr-reader", {
        fps: 10,
        qrbox: 300,
      });

      scanner.render(handleScan, () => {});
      scannerRef.current = scanner;
    }

    return () => {
      if (scannerRef.current) {
        scannerRef.current.clear().catch(() => {});
        const el = document.getElementById("qr-reader");
        if (el) el.innerHTML = "";
        scannerRef.current = null;
      }
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div className="bg-white p-8 rounded-xl w-full max-w-md relative">
        <button
          onClick={onClose}
          className="absolute top-2 right-2 text-gray-600 hover:text-black"
        >
          ✕
        </button>
        <div id="qr-reader" className="w-full h-80" />
        {!scanning && (
          <div className="flex justify-center mt-4">
            <Loader2Icon className="animate-spin text-blue-500" />
          </div>
        )}
      </div>
    </div>
  );
}
