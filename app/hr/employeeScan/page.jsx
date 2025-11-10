"use client";

import React, { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import {
  storeClockTime,
  storeClockTimeNew,
} from "@/server/2FAServer/qrcodeServer";
import { io } from "socket.io-client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { fetchLiveOfficeClock } from "@/server/timeOffServer/timeOffServer";
import { useSession } from "next-auth/react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Clock4, Coffee, LogOut, TimerOff, Loader2 } from "lucide-react";
import { format } from "date-fns";

export default function EmployeeClockScanner({ siteId }) {
  const [attendanceData, setAttendanceData] = useState({});
  const [selectedAction, setSelectedAction] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [avatar, setAvatar] = useState(null);
  const socketRef = useRef(null);
  const { data: session } = useSession();
  const employeeId = session?.user?._id;

  // Fetch current attendance
  const fetchAttendance = async () => {
    try {
      const response = await fetchLiveOfficeClock({ employeeId });
      if (response?.success) {
        setAttendanceData(JSON.parse(response.data) || {});
      }
    } catch (err) {
      console.error("Failed to fetch attendance:", err);
    }
  };

  useEffect(() => {
    if (typeof window !== "undefined") {
      const selectedAvatar =
        localStorage.getItem("selectedAvatar") ||
        "https://res.cloudinary.com/drcjzx0sw/image/upload/v1746444818/hr_jlxx1c.svg";
      setAvatar(selectedAvatar);
    }
  }, []);

  // Determine the **next allowed action**
  const getAvailableActions = (status) => {
    if (!status?.clockIn) return ["clockIn"];
    if (status?.clockIn && !status?.breakIn && !status?.clockOut)
      return ["breakIn", "clockOut"];
    if (status?.breakIn && !status?.breakOut) return ["breakOut"];
    if (status?.breakOut && !status?.clockOut) return ["clockOut"];
    return [];
  };

  const availableActions = getAvailableActions(attendanceData);

  useEffect(() => {
    if (employeeId) fetchAttendance();
  }, [employeeId]);

  // Setup socket for live updates
  useEffect(() => {
    if (!employeeId) return; // 🚨 wait for session to load

    if (!socketRef.current) {
      socketRef.current = io(process.env.NEXT_PUBLIC_WEB_URL);

      socketRef.current.on("refresh-clock-table", (updatedEmployeeId) => {
        console.log(
          "Received refresh-clock-table for:",
          updatedEmployeeId,
          employeeId
        );
        if (updatedEmployeeId === employeeId) {
          fetchAttendance();
        }
      });

      socketRef.current.on("disconnect", () =>
        console.log("Socket disconnected")
      );
    }

    fetchAttendance(); // Initial load after we know employeeId

    return () => {
      socketRef.current?.disconnect();
      socketRef.current = null;
    };
  }, [employeeId]); // 👈 depend on employeeId

  return (
    <div className="space-y-4">
      <Card className={"max-w-sm"}>
        <CardHeader className="space-y-3">
          <CardTitle>
            <div className="flex items-center gap-2">
              <img
                src={
                  avatar ||
                  "https://res.cloudinary.com/drcjzx0sw/image/upload/v1746444818/hr_jlxx1c.svg"
                }
                alt={session?.user?.name || "User Avatar"}
                width={40}
                height={40}
                className="rounded-full"
              />
              {session?.user?.name || "User"}'s Attendance
            </div>
          </CardTitle>
          <CardDescription className="flex items-center gap-2 text-indigo-600">
            <Clock4 className="size-4" /> Clock {format(new Date(), "PPPP")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {attendanceData && (
            <div className="space-y-4">
              {[
                {
                  name: "Clock",
                  data: [
                    {
                      label: "Clock In",
                      value: attendanceData?.clockIn || "--",
                    },
                    {
                      label: "Clock Out",
                      value: attendanceData?.clockOut || "--",
                    },
                  ],
                },
                {
                  name: "Break",
                  data: [
                    {
                      label: "Break In",
                      value: attendanceData?.breakIn || "--",
                    },
                    {
                      label: "Break Out",
                      value: attendanceData?.breakOut || "--",
                    },
                  ],
                },
              ].map((clock) => (
                <div key={clock?.name} className="flex gap-6 max-w-full">
                  {clock?.data?.map((item) => (
                    <div
                      key={item?.label}
                      className="bg-gray-200 p-2 px-4 border border-gray-400 space-y-0.5 flex-1 rounded-md"
                    >
                      <p className="text-sm text-gray-500 font-medium">
                        {item?.label}
                      </p>
                      <span className="text-base font-medium text-gray-800 tracking-tight">
                        {item?.value || "--"}
                      </span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
          {/* Button */}
          <div className="flex gap-2 flex-wrap max-w-full mt-6">
            {attendanceData?.employeeId &&
              availableActions?.map((action) => (
                <Button
                  key={action}
                  onClick={() => {
                    setSelectedAction(action);
                    setDialogOpen(true);
                  }}
                  className={"flex-1 h-12 text-base"}
                >
                  {action === "clockIn" && (
                    <>
                      <Clock4 className="size-4.5" /> Clock In
                    </>
                  )}
                  {action === "breakIn" && (
                    <>
                      <Coffee className="size-4.5" />
                      Break In
                    </>
                  )}
                  {action === "breakOut" && (
                    <>
                      <TimerOff className="size-4.5" />
                      Break Out
                    </>
                  )}
                  {action === "clockOut" && (
                    <>
                      <LogOut className="size-4.5" />
                      Clock Out
                    </>
                  )}
                </Button>
              ))}
          </div>
        </CardContent>
      </Card>

      <ScannerDialog
        siteId={siteId}
        action={selectedAction}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        employeeId={employeeId}
      />
    </div>
  );
}

/** =====================
 * Scanner Dialog
 * ===================== */
// function ScannerDialog({ siteId, action, open, onOpenChange, employeeId }) {
//   const scannerRef = useRef(null);
//   const audioRef = useRef(null);
//   const errorAudioRef = useRef(null);
//   const socketRef = useRef(null);

//   useEffect(() => {
//     audioRef.current = new Audio("/audio/beep.mp3");
//     errorAudioRef.current = new Audio("/audio/error.mp3");
//   }, []);

//   const stopScanner = () => {
//     if (scannerRef.current) {
//       scannerRef.current
//         .stop()
//         .then(() => {
//           scannerRef.current.clear();
//           scannerRef.current = null;
//         })
//         .catch(() => {});
//     }
//   };

//   const handleScan = async (decodedText) => {
//     try {
//       const response = await storeClockTime(decodedText, siteId, action);

//       if (response.success) {
//         toast.success(`✅ ${action.replace(/([A-Z])/g, " $1")} success`);
//         try {
//           await audioRef.current.play();
//         } catch {}

//         if (!socketRef.current) {
//           socketRef.current = io(process.env.NEXT_PUBLIC_WEB_URL);
//         }

//         socketRef.current.emit("employee-scan-qr", {
//           token: decodedText,
//           employeeId,
//           action,
//         });

//         stopScanner();
//         onOpenChange(false);
//       } else {
//         toast.error(response.message || "❌ Scan failed");
//         try {
//           await errorAudioRef.current.play();
//         } catch {}
//       }
//     } catch (err) {
//       console.error(err);
//       toast.error("❌ Scan failed");
//     }
//   };

//   useEffect(() => {
//     if (!open) return;

//     const timer = setTimeout(() => {
//       const scanner = new Html5Qrcode("qr-reader");
//       scannerRef.current = scanner;
//       scanner
//         .start(
//           { facingMode: "environment" },
//           { fps: 10, qrbox: 250 },
//           handleScan
//         )
//         .catch((err) => console.error("Scanner start failed:", err));
//     }, 100);

//     return () => {
//       clearTimeout(timer);
//       stopScanner();
//     };
//   }, [open]);

//   return (
//     <Dialog open={open} onOpenChange={onOpenChange}>
//       <DialogContent className="w-full max-w-md h-[70vh] bg-white rounded-lg shadow-lg p-4 flex flex-col items-center justify-center">
//         <DialogHeader>
//           <DialogTitle>
//             Scan QR for {action.replace(/([A-Z])/g, " $1")}
//           </DialogTitle>
//           <DialogDescription>
//             Hold your camera over the QR code to continue.
//           </DialogDescription>
//         </DialogHeader>

//         <div
//           id="qr-reader"
//           className="w-full h-full bg-gray-100 rounded-md mt-4"
//         />

//         <Button
//           className="mt-4 w-full bg-red-500 hover:bg-red-600"
//           onClick={() => {
//             stopScanner();
//             onOpenChange(false);
//           }}
//         >
//           Cancel
//         </Button>
//       </DialogContent>
//     </Dialog>
//   );
// }

// function ScannerDialog({ siteId, action, open, onOpenChange, employeeId }) {
//   const scannerRef = useRef(null);
//   const audioRef = useRef(null);
//   const errorAudioRef = useRef(null);
//   const socketRef = useRef(null);

//   const [cameras, setCameras] = useState([]);
//   const [currentCameraIndex, setCurrentCameraIndex] = useState(0);

//   useEffect(() => {
//     audioRef.current = new Audio("/audio/beep.mp3");
//     errorAudioRef.current = new Audio("/audio/error.mp3");
//   }, []);

//   const stopScanner = () => {
//     if (scannerRef.current) {
//       scannerRef.current
//         .stop()
//         .then(() => {
//           scannerRef.current.clear();
//           scannerRef.current = null;
//         })
//         .catch(() => {});
//     }
//   };

//   const startScanner = async (cameraId = null) => {
//     try {
//       const scanner = new Html5Qrcode("qr-reader");
//       scannerRef.current = scanner;

//       const config = { fps: 10, qrbox: 250 };
//       if (cameraId) {
//         await scanner.start(
//           { deviceId: { exact: cameraId } },
//           config,
//           handleScan
//         );
//       } else {
//         await scanner.start({ facingMode: "environment" }, config, handleScan);
//       }
//     } catch (err) {
//       console.error("Scanner start failed:", err);
//     }
//   };

//   const handleScan = async (decodedText) => {
//     try {
//       const response = await storeClockTime(decodedText, siteId, action);

//       if (response.success) {
//         toast.success(`✅ ${action.replace(/([A-Z])/g, " $1")} success`);
//         try {
//           await audioRef.current.play();
//         } catch {}

//         if (!socketRef.current) {
//           socketRef.current = io(process.env.NEXT_PUBLIC_WEB_URL);
//         }

//         socketRef.current.emit("employee-scan-qr", {
//           token: decodedText,
//           employeeId,
//           action,
//         });

//         stopScanner();
//         onOpenChange(false);
//       } else {
//         toast.error(response.message || "❌ Scan failed");
//         try {
//           await errorAudioRef.current.play();
//         } catch {}
//       }
//     } catch (err) {
//       console.error(err);
//       toast.error("❌ Scan failed");
//     }
//   };

//   // Load available cameras and start default one
//   useEffect(() => {
//     if (!open) return;

//     const initScanner = async () => {
//       try {
//         const devices = await Html5Qrcode.getCameras();
//         if (devices && devices.length > 0) {
//           setCameras(devices);
//           setCurrentCameraIndex(0);
//           await startScanner(devices[0].id);
//         }
//       } catch (err) {
//         console.error("Error fetching cameras:", err);
//         // fallback to facingMode
//         await startScanner();
//       }
//     };

//     initScanner();

//     return () => {
//       stopScanner();
//     };
//   }, [open]);

//   // Handle camera switching
//   const switchCamera = async () => {
//     if (cameras.length < 2) return;
//     const newIndex = (currentCameraIndex + 1) % cameras.length;
//     setCurrentCameraIndex(newIndex);

//     stopScanner();
//     await startScanner(cameras[newIndex].id);
//   };

//   return (
//     <Dialog open={open} onOpenChange={onOpenChange}>
//       <DialogContent className="w-full max-w-md h-[70vh] bg-white rounded-lg shadow-lg p-4 flex flex-col items-center justify-center">
//         <DialogHeader>
//           <DialogTitle>
//             Scan QR for {action.replace(/([A-Z])/g, " $1")}
//           </DialogTitle>
//           <DialogDescription>
//             Hold your camera over the QR code to continue.
//           </DialogDescription>
//         </DialogHeader>

//         <div
//           id="qr-reader"
//           className="w-full h-full bg-gray-100 rounded-md mt-4"
//         />

//         <div className="flex gap-2 w-full mt-4">
//           {cameras.length > 1 && (
//             <Button
//               onClick={switchCamera}
//               className="flex-1 bg-indigo-500 hover:bg-indigo-600"
//             >
//               Switch Camera
//             </Button>
//           )}
//           <Button
//             className="flex-1 bg-red-500 hover:bg-red-600"
//             onClick={() => {
//               stopScanner();
//               onOpenChange(false);
//             }}
//           >
//             Cancel
//           </Button>
//         </div>
//       </DialogContent>
//     </Dialog>
//   );
// }

export function ScannerDialog({
  siteId,
  action,
  open,
  onOpenChange,
  employeeId,
}) {
  const scannerRef = useRef(null);
  const audioRef = useRef(null);
  const errorAudioRef = useRef(null);
  const socketRef = useRef(null);

  const [cameras, setCameras] = useState([]);
  const [currentCameraIndex, setCurrentCameraIndex] = useState(0);
  const [activeCameraLabel, setActiveCameraLabel] = useState("");
  const [permissionError, setPermissionError] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    audioRef.current = new Audio("/audio/beep.mp3");
    errorAudioRef.current = new Audio("/audio/error.mp3");
  }, []);

  const stopScanner = () => {
    if (scannerRef.current) {
      scannerRef.current
        .stop()
        .then(() => {
          scannerRef.current.clear();
          scannerRef.current = null;
        })
        .catch(() => {});
    }
  };

  const startScanner = async (cameraId = null, label = "") => {
    setLoading(true);
    try {
      const scanner = new Html5Qrcode("qr-reader");
      scannerRef.current = scanner;

      const config = { fps: 10, qrbox: 250 };

      if (cameraId) {
        await scanner.start(
          { deviceId: { exact: cameraId } },
          config,
          handleScan
        );
        setActiveCameraLabel(label || "Unknown Camera");

        // ✅ Add notification here
        toast.success(`Switched to ${label || "camera"}`);
      } else {
        await scanner.start({ facingMode: "environment" }, config, handleScan);
        setActiveCameraLabel("Back Camera");

        // ✅ Add notification here too
        toast.success("Switched to Back Camera");
      }

      setPermissionError(false);
    } catch (err) {
      console.error("Scanner start failed:", err);
      if (
        err?.name === "NotAllowedError" ||
        err?.message?.includes("permission")
      ) {
        setPermissionError(true);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleScan = async (decodedText) => {
    try {
      const response = await storeClockTime(decodedText, siteId, action);

      if (response.success) {
        toast.success(`✅ ${action.replace(/([A-Z])/g, " $1")} success`);
        try {
          await audioRef.current.play();
        } catch {}

        if (!socketRef.current) {
          socketRef.current = io(process.env.NEXT_PUBLIC_WEB_URL);
        }

        socketRef.current.emit("employee-scan-qr", {
          token: decodedText,
          employeeId,
          action,
        });

        stopScanner();
        onOpenChange(false);
      } else {
        toast.error(response.message || "❌ Scan failed");
        try {
          await errorAudioRef.current.play();
        } catch {}
      }
    } catch (err) {
      console.error(err);
      toast.error("❌ Scan failed");
    }
  };

  // Load available cameras and start default one
  useEffect(() => {
    if (!open) return;

    const initScanner = async () => {
      try {
        const devices = await Html5Qrcode.getCameras();
        if (devices && devices.length > 0) {
          // start with the back camera if available
          let backCamera = devices.find((device) =>
            /back|rear|environment/gi.test(device.label)
          );
          if (!backCamera) {
            backCamera = devices[devices.length - 1]; // fallback to last camera
          }
          setCameras(devices);
          const backCameraIndex = devices.findIndex(
            (device) => device.id === backCamera.id
          );
          setCurrentCameraIndex(backCameraIndex);
          await startScanner(backCamera.id, backCamera.label);
        }
      } catch (err) {
        console.error("Error fetching cameras:", err);
        await startScanner(); // fallback
      }
    };

    initScanner();

    return () => {
      stopScanner();
    };
  }, [open]);

  // Auto-retry when permission is granted
  useEffect(() => {
    if (permissionError) {
      const retry = setInterval(async () => {
        try {
          const devices = await Html5Qrcode.getCameras();
          if (devices.length > 0) {
            clearInterval(retry);
            setPermissionError(false);
            await startScanner(devices[0].id, devices[0].label);
          }
        } catch {
          // keep retrying silently
        }
      }, 2000);

      return () => clearInterval(retry);
    }
  }, [permissionError]);

  // Handle camera switching
  const switchCamera = async () => {
    if (cameras.length < 2) return;
    const newIndex = (currentCameraIndex + 1) % cameras.length;
    setCurrentCameraIndex(newIndex);

    stopScanner();
    await startScanner(cameras[newIndex].id, cameras[newIndex].label);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-full max-w-md h-[75vh] bg-white rounded-lg shadow-lg p-4 flex flex-col">
        <DialogHeader>
          <DialogTitle>
            Scan QR for
            {action && action.replace(/([A-Z])/g, " $1")}
          </DialogTitle>
          <DialogDescription>
            Hold your camera over the QR code to continue.
          </DialogDescription>
        </DialogHeader>

        <div className="relative flex-1 w-full mt-4">
          <div
            id="qr-reader"
            className="w-full h-full bg-gray-100 rounded-md"
          />
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-white/80 rounded-md">
              <Loader2 className="animate-spin w-6 h-6 text-indigo-600" />
              <span className="ml-2 text-gray-700">Switching camera...</span>
            </div>
          )}
        </div>

        {/* Show which camera is active */}
        {activeCameraLabel && (
          <p className="text-sm text-gray-600 mt-2 text-center">
            📷 Active Camera:{" "}
            <span className="font-medium">{activeCameraLabel}</span>
          </p>
        )}

        {/* Permission error message */}
        {permissionError && (
          <div className="text-red-600 text-sm text-center mt-3 bg-red-50 border border-red-300 p-2 rounded">
            🚫 Camera access denied. Please allow camera permissions in your
            browser settings.
          </div>
        )}

        <div className="flex gap-2 w-full mt-4">
          {cameras.length > 1 && (
            <Button
              onClick={switchCamera}
              className="flex-1 bg-indigo-500 hover:bg-indigo-600"
              disabled={loading}
            >
              Switch Camera
            </Button>
          )}
          <Button
            className="flex-1 bg-red-500 hover:bg-red-600"
            onClick={() => {
              stopScanner();
              onOpenChange(false);
            }}
          >
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
