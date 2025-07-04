"use client";
import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import QRCode from "qrcode";
import { useSession } from "next-auth/react";
import { Clock4, Coffee, LogOut, RefreshCw, TimerOff } from "lucide-react";
import { Button } from "../ui/button";
import Image from "next/image";
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogContent,
} from "../ui/dialog";
import { useFetchQuery } from "@/hooks/use-query";
import { getEmployeeTodayAttendanceData } from "@/server/timeOffServer/timeOffServer";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../ui/card";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { useTime } from "@/hooks/useTime";

export default function QRCodeSocket() {
  const { data: session } = useSession();
  const currentTime = useTime();
  const [qrData, setQrData] = useState("");
  const [limitReached, setLimitReached] = useState(false);
  const [showSetupDialog, setShowSetupDialog] = useState(false);
  const [currentAction, setCurrentAction] = useState("");
  const socketRef = useRef(null);
  const employeeId = session?.user?._id;
  const queryClient = useQueryClient();

  const queryKey = [employeeId];

  const { data: fetchData } = useFetchQuery({
    params: employeeId,
    fetchFn: getEmployeeTodayAttendanceData,
    queryKey,
  });

  const { newData: employeeStatus } = fetchData || {};

  const getAvailableActions = (status) => {
    if (!status?.clockIn) return ["clockIn"];
    if (status.clockIn && !status.breakIn && !status.clockOut)
      return ["breakIn", "clockOut"];
    if (status.breakIn && !status.breakOut) return ["breakOut"];
    if (status.breakOut && !status.clockOut) return ["clockOut"];
    return [];
  };

  const setQrCode = async (token) => {
    if (token) {
      try {
        const qr = await QRCode.toDataURL(token);
        setQrData(qr);
      } catch (error) {
        console.error("Error generating QR code:", error);
        // Handle the error appropriately, maybe set an error state
      }
    } else {
      setQrData(""); // Clear QR data if no token is received
    }
  };

  const handleActionClick = (action) => {
    if (socketRef.current && employeeId) {
      socketRef.current.emit("manual-request", { employeeId, action });
      setCurrentAction(action);
      setQrData(""); // clear before new
      setShowSetupDialog(true);
      setLimitReached(false);
    }
  };

  useEffect(() => {
    if (!employeeId || !session) return;

    if (!socketRef.current) {
      socketRef.current = io(process.env.NEXT_PUBLIC_WEB_URL);

      socketRef.current.on("connect", () => {
        console.log("Socket connected:", socketRef.current.id);
      });

      socketRef.current.on("new-qr-token", async (token) => {
        await setQrCode(token);
      });

      socketRef.current.on("refresh-clock-table", (employeeId) => {
        console.log("clock updated, invalidating query...");
        queryClient.invalidateQueries({ queryKey });
      });

      socketRef.current.on("token-limit-reached", () => {
        setQrData("");
        setLimitReached(true);
        setShowSetupDialog(false);
      });

      socketRef.current.on("disconnect", () => {
        console.log("Socket disconnected");
      });
    }

    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    };
  }, [session, employeeId]);
  const availableActions = getAvailableActions(employeeStatus);

  return (
    <>
      <Card className={"max-w-sm"}>
        <CardHeader className="space-y-3">
          <CardTitle>Clock In / Out</CardTitle>
          <CardDescription className="flex items-center gap-2">
            <Clock4 className="size-4" /> Clock{" "}
            {format(new Date(), "EEEE, d LLL R")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-8 mb-4 justify-center">
            <p className="flex flex-col items-center text-xl font-semibold text-gray-700">
              {currentTime.toLocaleTimeString()}
              <span className="text-sm tracking-tight text-gray-500 font-medium">
                Current time
              </span>
            </p>
          </div>
          <div className="space-y-4">
            {[
              {
                name: "Clock",
                data: [
                  { label: "Clock In", value: employeeStatus?.clockIn || "--" },
                  {
                    label: "Clock Out",
                    value: employeeStatus?.clockOut || "--",
                  },
                ],
              },
              {
                name: "Break",
                data: [
                  { label: "Break In", value: employeeStatus?.breakIn || "--" },
                  {
                    label: "Break Out",
                    value: employeeStatus?.breakOut || "--",
                  },
                ],
              },
            ].map((clock) => (
              <div key={clock.name} className="flex gap-6 max-w-full">
                {clock.data.map((item) => (
                  <div
                    key={item.label}
                    className="bg-gray-200 p-2 px-4 border border-gray-400 space-y-0.5 flex-1"
                  >
                    <p className="text-sm text-gray-500 font-medium">
                      {item.label}
                    </p>
                    <span className="text-base font-medium text-gray-800 tracking-tight">
                      {item.value || "--"}
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>

          <div className="flex gap-2 flex-wrap max-w-full mt-6">
            {availableActions.map((action) => (
              <Button
                key={action}
                onClick={() => handleActionClick(action)}
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

      <Dialog open={showSetupDialog} onOpenChange={setShowSetupDialog}>
        <DialogContent className="w-full max-w-2xl max-h-screen overflow-y-auto bg-white rounded-lg shadow-lg p-6 sm:max-w-xs md:max-w-sm lg:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base tracking-tight">
              Your QR Code for {currentAction}
            </DialogTitle>
            <DialogDescription className="tracking-tight">
              Scan this code to{" "}
              {currentAction.replace(/([A-Z])/g, " $1").toLowerCase()}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col items-center justify-center pb-4">
            <div className="border p-0.5 rounded-md bg-white mb-8">
              {qrData ? (
                <Image
                  src={qrData}
                  alt="QR Code"
                  className="w-64 h-64 object-contain"
                  width={192}
                  height={192}
                />
              ) : (
                <div className="w-64 h-64 bg-gradient-to-tl from-blue-500 to-blue-300 animate-pulse rounded-md" />
              )}
            </div>

            {limitReached && (
              <>
                <Button
                  size="sm"
                  onClick={() => handleActionClick(currentAction)}
                >
                  <RefreshCw className="mr-1 w-4 h-4" />
                  Refresh Code
                </Button>
                <div className="bg-red-50 w-full mt-4 p-2 rounded-md text-red-600 text-sm">
                  Token limit reached. Please refresh.
                </div>
              </>
            )}

            {!limitReached && !qrData && <p>Generating QR Code...</p>}
            {!limitReached && qrData && <p>Scan the QR Code to continue</p>}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
