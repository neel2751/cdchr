// "use client";
// import { useSession } from "next-auth/react";
// import { Clock4, Coffee, LogOut, RefreshCw, TimerOff } from "lucide-react";
// import { Button } from "@/components/ui/button";
// import Image from "next/image";
// import {
//   Dialog,
//   DialogHeader,
//   DialogTitle,
//   DialogDescription,
//   DialogContent,
// } from "@/components/ui/dialog";
// import {
//   Card,
//   CardContent,
//   CardDescription,
//   CardHeader,
//   CardTitle,
// } from "@/components/ui/card";
// import { format } from "date-fns";
// import { Badge } from "@/components/ui/badge";
// import { useSiteAttendanceSocket } from "@/hooks/useAttendanceSocket";
// import { useFetchQuery } from "@/hooks/use-query";
// import { canEmployeeClockToday } from "@/server/siteAssignmentServer/siteAssignmentServer";

// export default function QRCodeSocket() {
//   const { data: session } = useSession();
//   const employeeId = session?.user?._id;

//   const { data: employeeData } = useFetchQuery({
//     fetchFn: canEmployeeClockToday,
//     queryKey: ["canEmployee"],
//   });

//   const { newData: site } = employeeData || {};
//   const siteId = site?._id;

//   const {
//     attendanceList,
//     qrData,
//     limitReached,
//     showSetupDialog,
//     currentAction,
//     setShowSetupDialog,
//     handleActionClick,
//     getAvailableActions,
//   } = useSiteAttendanceSocket({ employeeId, siteId });

//   const newData = attendanceList[0];
//   const availableActions = getAvailableActions(newData);

//   return (
//     <div className="sm:px-4 px-2 sm:py-6">
//       <Card className={"max-w-sm mx-auto"}>
//         <CardHeader className="space-y-3">
//           <div className="flex items-center gap-4">
//             <CardTitle>Hi, {session?.user?.name || "Employee"}!</CardTitle>
//             <div className="text-sm">
//               Site:{" "}
//               <Badge className={"bg-purple-100 text-purple-800"}>
//                 {newData?.site?.siteName || "Not Assign"}
//               </Badge>
//             </div>
//           </div>
//           <CardDescription className="flex items-center gap-2">
//             <Clock4 className="size-4" /> Clock{" "}
//             {format(new Date(), "EEEE, d LLL R")}
//           </CardDescription>
//         </CardHeader>
//         <CardContent>
//           <div className="flex gap-8 mb-4 justify-center">
//             <p className="flex flex-col items-center text-xl font-semibold text-gray-700">
//               {/* {currentTime.toLocaleTimeString()} */}
//               <span className="text-sm tracking-tight text-gray-500 font-medium">
//                 Current time
//               </span>
//             </p>
//           </div>
//           {newData ? (
//             <>
//               <div className="space-y-4">
//                 {[
//                   {
//                     name: "Clock",
//                     data: [
//                       {
//                         label: "Clock In",
//                         value: newData?.clockIn || "--",
//                       },
//                       {
//                         label: "Clock Out",
//                         value: newData?.clockOut || "--",
//                       },
//                     ],
//                   },
//                   {
//                     name: "Break",
//                     data: [
//                       {
//                         label: "Break In",
//                         value: newData?.breakIn || "--",
//                       },
//                       {
//                         label: "Break Out",
//                         value: newData?.breakOut || "--",
//                       },
//                     ],
//                   },
//                 ].map((clock) => (
//                   <div key={clock.name} className="flex gap-6 max-w-full">
//                     {clock.data.map((item) => (
//                       <div
//                         key={item.label}
//                         className="bg-gray-200 p-2 px-4 border border-gray-400 space-y-0.5 flex-1"
//                       >
//                         <p className="text-sm text-gray-500 font-medium">
//                           {item.label}
//                         </p>
//                         <span className="text-base font-medium text-gray-800 tracking-tight">
//                           {item.value || "--"}
//                         </span>
//                       </div>
//                     ))}
//                   </div>
//                 ))}
//               </div>
//               {/* Button */}
//               <div className="flex gap-2 flex-wrap max-w-full mt-6">
//                 {availableActions.map((action) => (
//                   <Button
//                     key={action}
//                     onClick={() => handleActionClick(action)}
//                     className={"flex-1 h-12 text-base"}
//                   >
//                     {action === "clockIn" && (
//                       <>
//                         <Clock4 className="size-4.5" /> Clock In
//                       </>
//                     )}
//                     {action === "breakIn" && (
//                       <>
//                         <Coffee className="size-4.5" />
//                         Break In
//                       </>
//                     )}
//                     {action === "breakOut" && (
//                       <>
//                         <TimerOff className="size-4.5" />
//                         Break Out
//                       </>
//                     )}
//                     {action === "clockOut" && (
//                       <>
//                         <LogOut className="size-4.5" />
//                         Clock Out
//                       </>
//                     )}
//                   </Button>
//                 ))}
//               </div>
//             </>
//           ) : (
//             <div className="h-full w-full flex items-center flex-col gap-4">
//               <Image
//                 src={"/images/qr.svg"}
//                 width={120}
//                 height={120}
//                 alt="Assign Employee"
//               />
//               <CardTitle className={"text-center"}>
//                 Admin Didn't assign site today. <br />
//                 Please contact admin
//               </CardTitle>
//             </div>
//           )}
//         </CardContent>
//       </Card>

//       <Dialog open={showSetupDialog} onOpenChange={setShowSetupDialog}>
//         <DialogContent className="w-full max-w-2xl max-h-screen overflow-y-auto bg-white rounded-lg shadow-lg p-6 sm:max-w-xs md:max-w-sm lg:max-w-md">
//           <DialogHeader>
//             <DialogTitle className="text-base tracking-tight">
//               Your QR Code for {currentAction}
//             </DialogTitle>
//             <DialogDescription className="tracking-tight">
//               Scan this code to{" "}
//               {currentAction.replace(/([A-Z])/g, " $1").toLowerCase()}
//             </DialogDescription>
//           </DialogHeader>

//           <div className="flex flex-col items-center justify-center pb-4">
//             <div className="border p-0.5 rounded-md bg-white mb-8">
//               {qrData ? (
//                 <Image
//                   src={qrData}
//                   alt="QR Code"
//                   className="w-64 h-64 object-contain"
//                   width={192}
//                   height={192}
//                 />
//               ) : (
//                 <div className="w-64 h-64 bg-gradient-to-tl from-blue-500 to-blue-300 animate-pulse rounded-md" />
//               )}
//             </div>

//             {limitReached && (
//               <>
//                 <Button
//                   size="sm"
//                   onClick={() => handleActionClick(currentAction)}
//                 >
//                   <RefreshCw className="mr-1 w-4 h-4" />
//                   Refresh Code
//                 </Button>
//                 <div className="bg-red-50 w-full mt-4 p-2 rounded-md text-red-600 text-sm">
//                   Token limit reached. Please refresh.
//                 </div>
//               </>
//             )}

//             {!limitReached && !qrData && <p>Generating QR Code...</p>}
//             {!limitReached && qrData && <p>Scan the QR Code to continue</p>}
//           </div>
//         </DialogContent>
//       </Dialog>
//     </div>
//   );
// }

"use client";
import { useState, useEffect, useRef } from "react";
import { useSession } from "next-auth/react";
import { Clock4, Coffee, LogOut, TimerOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { useFetchQuery } from "@/hooks/use-query";
import {
  canEmployeeClockToday,
  fetchAssignedWithClocksNew,
  fetchClockRecordsTest,
} from "@/server/siteAssignmentServer/siteAssignmentServer";
import { SiteEmployeeScannerDialog } from "../hr/employeeScan/page";
import { io } from "socket.io-client";

export default function SiteEmployeeScanner() {
  const { data: session } = useSession();
  const employeeId = session?.user?._id;

  const { data: employeeData } = useFetchQuery({
    fetchFn: canEmployeeClockToday,
    queryKey: ["canEmployeeSite"],
  });

  const siteId = employeeData?.newData?._id;

  const [attendanceData, setAttendanceData] = useState({});
  const [currentAction, setCurrentAction] = useState(null);
  const [scannerOpen, setScannerOpen] = useState(false);

  const socketRef = useRef(null);

  const fetchAttendance = async () => {
    if (employeeId && siteId) {
      try {
        const res = await fetchClockRecordsTest({ employeeId, siteId });
        setAttendanceData(JSON.parse(res.data)[0] || {});
      } catch (err) {
        console.log("Failed to fetch attendance:", err);
      }
    }
  };

  // Setup live socket
  useEffect(() => {
    if (!employeeId || !siteId) return; // 🚨 wait until both exist

    if (!socketRef.current) {
      socketRef.current = io(process.env.NEXT_PUBLIC_WEB_URL);

      // 👇 make sure event matches what server emits
      socketRef.current.on("refresh-clock-table", (updatedEmployeeId) => {
        console.log("Received refresh-clock-table for:", updatedEmployeeId);
        fetchAttendance(); // ✅ refetch and update screen
      });

      socketRef.current.on("disconnect", () =>
        console.log("Socket disconnected")
      );
    }

    // always fetch initial data once socket is ready
    fetchAttendance();

    return () => {
      socketRef.current?.disconnect();
      socketRef.current = null;
    };
  }, [employeeId, siteId]); // 👈 depend on both

  const getAvailableActions = (status) => {
    if (!status || !status.clockIn) return ["clockIn"];

    const breaks = status.breaks || [];
    const lastBreak = breaks.length ? breaks[breaks.length - 1] : null;

    // If currently on break
    if (lastBreak && !lastBreak.breakOut) return ["breakOut"];

    // If working and not clocked out
    if (status.clockIn && !status.clockOut) return ["breakIn", "clockOut"];

    // Already clocked out or invalid state
    return [];
  };

  const availableActions = getAvailableActions(attendanceData);

  const handleActionClick = (action) => {
    setCurrentAction(action);
    setScannerOpen(true);
  };

  return (
    <div className="sm:px-4 px-2 sm:py-6">
      <Card className={"max-w-sm mx-auto"}>
        <CardHeader className="space-y-3">
          <div className="flex items-center gap-4">
            <CardTitle>Hi, {session?.user?.name || "Employee"}!</CardTitle>
            <div className="text-sm">
              Site:{" "}
              <Badge className={"bg-purple-100 text-purple-800"}>
                {employeeData?.newData?.siteName || "Not Assign"}
              </Badge>
            </div>
          </div>
          <CardDescription className="flex items-center gap-2">
            <Clock4 className="size-4" /> Clock{" "}
            {format(new Date(), "EEEE, d LLL R")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {attendanceData && (
            <div className="space-y-4">
              {/* Clock Section */}
              <div className="flex gap-6 max-w-full">
                {[
                  { label: "Clock In", value: attendanceData?.clockIn || "--" },
                  {
                    label: "Clock Out",
                    value: attendanceData?.clockOut || "--",
                  },
                ].map((item) => (
                  <div
                    key={item.label}
                    className="bg-gray-200 p-2 px-4 border border-gray-400 flex-1 rounded-md"
                  >
                    <p className="text-sm text-gray-500 font-medium">
                      {item.label}
                    </p>
                    <span className="text-base font-medium text-gray-800 tracking-tight">
                      {item.value}
                    </span>
                  </div>
                ))}
              </div>

              {/* Breaks Section */}
              {attendanceData?.breaks?.length > 0 ? (
                <div className="space-y-3">
                  <p className="text-sm text-gray-500 font-semibold">Breaks</p>
                  {attendanceData.breaks.map((br, index) => (
                    <div key={index} className="flex gap-6 max-w-full">
                      <div className="bg-gray-200 p-2 px-4 border border-gray-400 flex-1 rounded-md">
                        <p className="text-sm text-gray-500 font-medium">
                          Break {index + 1} In
                        </p>
                        <span className="text-base font-medium text-gray-800 tracking-tight">
                          {br.breakIn || "--"}
                        </span>
                      </div>
                      <div className="bg-gray-200 p-2 px-4 border border-gray-400 flex-1 rounded-md">
                        <p className="text-sm text-gray-500 font-medium">
                          Break {index + 1} Out
                        </p>
                        <span className="text-base font-medium text-gray-800 tracking-tight">
                          {br.breakOut || "--"}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex gap-6 max-w-full">
                  <div className="bg-gray-200 p-2 px-4 border border-gray-400 flex-1 rounded-md">
                    <p className="text-sm text-gray-500 font-medium">
                      Break In
                    </p>
                    <span className="text-base font-medium text-gray-800 tracking-tight">
                      --
                    </span>
                  </div>
                  <div className="bg-gray-200 p-2 px-4 border border-gray-400 flex-1 rounded-md">
                    <p className="text-sm text-gray-500 font-medium">
                      Break Out
                    </p>
                    <span className="text-base font-medium text-gray-800 tracking-tight">
                      --
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex gap-2 flex-wrap max-w-full mt-6">
            {attendanceData?.employeeId &&
              availableActions.map((action) => (
                <Button
                  key={action}
                  onClick={() => {
                    handleActionClick(action);
                  }}
                  className="flex-1 h-12 text-base"
                >
                  {action === "clockIn" && (
                    <>
                      <Clock4 className="size-4.5 mr-1" /> Clock In
                    </>
                  )}
                  {action === "breakIn" && (
                    <>
                      <Coffee className="size-4.5 mr-1" /> Break In
                    </>
                  )}
                  {action === "breakOut" && (
                    <>
                      <TimerOff className="size-4.5 mr-1" /> Break Out
                    </>
                  )}
                  {action === "clockOut" && (
                    <>
                      <LogOut className="size-4.5 mr-1" /> Clock Out
                    </>
                  )}
                </Button>
              ))}
          </div>
        </CardContent>
      </Card>
      <SiteEmployeeScannerDialog
        open={scannerOpen}
        onOpenChange={setScannerOpen}
        action={currentAction}
        employeeId={employeeId}
        siteId={siteId}
      />
    </div>
  );
}
