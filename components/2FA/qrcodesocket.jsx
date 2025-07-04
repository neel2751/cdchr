"use client";
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
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../ui/card";
import { format } from "date-fns";
import { useAttendanceSocket } from "@/hooks/useAttendanceSocket";

export default function QRCodeSocket() {
  console.log("QRCodeSocket rendered");
  const { data: session } = useSession();
  const employeeId = session?.user?._id;

  const {
    attendanceList,
    qrData,
    limitReached,
    showSetupDialog,
    currentAction,
    setShowSetupDialog,
    handleActionClick,
    getAvailableActions,
  } = useAttendanceSocket({ employeeId });

  const newData = attendanceList[0];
  const availableActions = getAvailableActions(newData);

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
          {newData && (
            <div className="space-y-4">
              {[
                {
                  name: "Clock",
                  data: [
                    {
                      label: "Clock In",
                      value: newData?.clockIn || "--",
                    },
                    {
                      label: "Clock Out",
                      value: newData?.clockOut || "--",
                    },
                  ],
                },
                {
                  name: "Break",
                  data: [
                    {
                      label: "Break In",
                      value: newData?.breakIn || "--",
                    },
                    {
                      label: "Break Out",
                      value: newData?.breakOut || "--",
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
          )}
          {/* Button */}
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
