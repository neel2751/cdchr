"use client";
import {
  fetchAssignedWithClocks,
  fetchLiveSiteClocks,
  fetchLiveSiteClocksOld,
} from "@/server/siteAssignmentServer/siteAssignmentServer";
// hooks/useAttendanceSocket.js
import {
  fetchLiveOfficeClock,
  getEmployeeTodayAttendanceDataForAdmin,
  getTodayAttendanceData,
} from "@/server/timeOffServer/timeOffServer";
import { useEffect, useRef, useState, useCallback } from "react";
import { io } from "socket.io-client";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import QRCode from "qrcode";
import { decrypt } from "@/lib/algo";

export function useAttendanceSocketOld() {
  const socketRef = useRef(null);
  const [attendanceMap, setAttendanceMap] = useState({}); // employeeId → [clockData]

  const fetchInitialData = useCallback(async () => {
    const result = await getTodayAttendanceData();
    if (result) {
      try {
        const initialClockData = JSON.parse(result);
        const initialMap = {};
        initialClockData.forEach((item) => {
          if (item.employeeId) {
            initialMap[item.employeeId] = initialMap[item.employeeId] || [];
            initialMap[item.employeeId].push(item);
          }
        });
        setAttendanceMap(initialMap);
      } catch (error) {
        console.log("Failed to parse initial attendance data:", error);
        toast.error("Failed to load initial attendance data");
      }
    } else {
      console.log("Failed to fetch initial attendance data");
      toast.error("Failed to load initial attendance data");
    }
  }, []);

  useEffect(() => {
    if (!socketRef.current) {
      socketRef.current = io(process.env.NEXT_PUBLIC_WEB_URL);

      socketRef.current.on("connect", () => {
        console.log("✅ Socket connected:", socketRef.current.id);
        fetchInitialData(); // Fetch initial data after connecting
      });

      socketRef.current.on("refresh-clock-table", async (employeeId) => {
        toast.success(`📥 New scan from employee: ${employeeId}`);
        const result = await getEmployeeTodayAttendanceDataForAdmin(employeeId);
        if (result) {
          try {
            const clockData = JSON.parse(result);
            setAttendanceMap((prev) => ({
              ...prev,
              [employeeId]: clockData,
            }));
          } catch (error) {
            console.error("❌ Failed to parse updated clock data:", error);
            toast.error("Failed to fetch updated clock data");
          }
        } else {
          console.error("❌ Failed to fetch updated clock data");
          toast.error("Failed to fetch updated clock data");
        }
      });
    }

    return () => {
      socketRef.current?.disconnect();
      socketRef.current = null;
    };
  }, [fetchInitialData]); // Include fetchInitialData in the dependency array

  return {
    attendanceList: Object.values(attendanceMap).flat(), // All employee records combined
  };
}

export function useSiteAttendanceSocketOld(siteId = null) {
  const socketRef = useRef(null);
  const [attendanceMap, setAttendanceMap] = useState({}); // employeeId → [clockData]

  const loadData = useCallback(async ({ siteId = null, employeeId = null }) => {
    try {
      const res = await fetchLiveSiteClocks({ siteId, employeeId });
      const data = JSON.parse(res?.data);
      const map = {};

      data?.forEach((item) => {
        const empId = item?.employee?._id;
        if (!empId) return;
        map[empId] = map[empId] || [];
        map[empId].push(item);
      });

      return map;
    } catch (err) {
      console.error("❌ Error fetching clock data:", err);
      toast.error("Failed to load attendance data");
      return null;
    }
  }, []);

  useEffect(() => {
    if (!socketRef.current) {
      socketRef.current = io(process.env.NEXT_PUBLIC_WEB_URL);

      socketRef.current.on("connect", async () => {
        console.log("✅ Socket connected:", socketRef.current.id);
        const map = await loadData({ siteId });
        if (map) setAttendanceMap(map);
      });

      socketRef.current.on("refresh-clock-table", async (employeeId) => {
        toast.success(`📥 New scan from employee: ${employeeId}`);
        const updatedMap = await loadData({ employeeId });
        if (updatedMap && updatedMap[employeeId]) {
          setAttendanceMap((prev) => ({
            ...prev,
            [employeeId]: updatedMap[employeeId],
          }));
        }
      });
    }

    return () => {
      socketRef.current?.disconnect();
      socketRef.current = null;
    };
  }, [loadData, siteId]);

  return {
    attendanceList: Object.values(attendanceMap).flat(),
    attendanceMap,
    socket: socketRef.current,
  };
}

export function useAttendanceSocket({
  siteId = null,
  employeeId = null,
  query = null,
  fromDate = null,
  toDate = null,
  currentPage = 1,
  pagePerData = 10,
}) {
  const socketRef = useRef(null);
  const queryClient = useQueryClient();
  const queryKey = [
    "OfficeEmployeeClock",
    { siteId, employeeId, query, currentPage, pagePerData, fromDate, toDate },
  ];

  const [qrData, setQrData] = useState("");
  const [limitReached, setLimitReached] = useState(false);
  const [currentAction, setCurrentAction] = useState("");
  const [showSetupDialog, setShowSetupDialog] = useState(false);
  const [total, setTotal] = useState();

  const loadData = useCallback(
    async ({ siteId, employeeId, currentPage, pagePerData, query }) => {
      try {
        const res = await fetchLiveOfficeClock({
          siteId,
          employeeId,
          query,
          page: currentPage,
          pageSize: pagePerData,
          fromDate,
          toDate,
        });

        const data = JSON.parse(res?.data);
        setTotal(res.totalCount);
        return data;
      } catch (err) {
        console.error("❌ Error fetching clock data:", err);
        toast.error("Failed to load attendance data");
        return null;
      }
    },
    []
  );

  const { data: attendanceMap = {}, refetch } = useQuery({
    queryKey,
    queryFn: () =>
      loadData({
        siteId,
        employeeId,
        query,
        pagePerData,
        currentPage,
        fromDate,
        toDate,
      }),
  });

  const attendanceList = Object.values(attendanceMap).flat();

  // QR code generator helper
  const generateQrCode = async (token) => {
    if (!token) {
      setQrData("");
      return;
    }
    try {
      const qr = await QRCode.toDataURL(token);
      setQrData(qr);
    } catch (err) {
      console.error("Error generating QR code:", err);
    }
  };

  // Handle manual actions (clock in/out, breaks, etc.)
  const handleActionClick = (action) => {
    if (socketRef.current && (employeeId || siteId)) {
      socketRef.current.emit("manual-request", {
        employeeId,
        action,
        siteId,
      });
      setCurrentAction(action);
      setQrData("");
      setShowSetupDialog(true);
      setLimitReached(false);
    }
  };

  // Determine available actions based on employee status
  const getAvailableActions = (status) => {
    if (!status?.clockIn) return ["clockIn"];
    if (status?.clockIn && !status?.breakIn && !status?.clockOut)
      return ["breakIn", "clockOut"];
    if (status?.breakIn && !status?.breakOut) return ["breakOut"];
    if (status?.breakOut && !status?.clockOut) return ["clockOut"];
    return [];
  };
  useEffect(() => {
    if (!socketRef.current) {
      socketRef.current = io(process.env.NEXT_PUBLIC_WEB_URL);

      socketRef.current.on("connect", async () => {
        console.log("Socket connected", socketRef.current.id);
        await refetch();
      });

      socketRef.current.on("new-qr-token", async (token) => {
        await generateQrCode(token);
      });

      socketRef.current.on("refresh-clock-table", async (updatedEmployeeId) => {
        console.log("🔁 Received refresh-clock-table for employee:");

        // Optional: check if this employeeId matches the current employee
        if (!employeeId || updatedEmployeeId === employeeId) {
          await refetch(); // This will re-fetch attendance data
          console.log("📥 Employee data reloaded");
        }
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
      socketRef.current?.disconnect();
      socketRef.current = null;
    };
  }, [loadData, siteId, employeeId, queryClient]);

  return {
    attendanceList,
    attendanceMap,
    qrData,
    limitReached,
    currentAction,
    showSetupDialog,
    setShowSetupDialog,
    handleActionClick,
    getAvailableActions,
    queryKey,
    socket: socketRef.current,
    total,
  };
}

export function useSiteAttendanceSocket({
  siteId = null,
  employeeId = null,
  query = null,
  fromDate = null,
  toDate = null,
  currentPage = 1,
  pagePerData = 10,
}) {
  const socketRef = useRef(null);
  const queryClient = useQueryClient();
  const siteOId = siteId ? decrypt(siteId) : null;
  const queryKey = [
    "siteClock",
    { siteOId, employeeId, query, currentPage, pagePerData, fromDate, toDate },
  ];
  const [qrData, setQrData] = useState("");
  const [limitReached, setLimitReached] = useState(false);
  const [currentAction, setCurrentAction] = useState("");
  const [showSetupDialog, setShowSetupDialog] = useState(false);
  const [total, setTotal] = useState();
  // Load attendance data based on passed params (siteId or employeeId)
  const loadData = useCallback(
    async ({ employeeId, currentPage, pagePerData, query }) => {
      try {
        const res = await fetchAssignedWithClocks({
          siteId: siteOId,
          employeeId,
          query,
          page: currentPage,
          pageSize: pagePerData,
          fromDate,
          toDate,
        });
        const data = JSON.parse(res?.data);
        setTotal(res.totalCount || 0);
        const map = {};

        data?.forEach((item) => {
          const empId = item?.employeeId;
          if (!empId) return;
          if (!map[empId]) map[empId] = [];
          map[empId].push(item);
        });

        return map;
      } catch (err) {
        console.error("❌ Error fetching clock data:", err);
        toast.error("Failed to load attendance data");
        return null;
      }
    },
    []
  );

  const { data: attendanceMap = {}, refetch } = useQuery({
    queryKey,
    queryFn: () =>
      loadData({
        employeeId,
        query,
        pagePerData,
        currentPage,
        fromDate,
        toDate,
      }),
  });

  const attendanceList = Object.values(attendanceMap).flat();

  // QR code generator helper
  const generateQrCode = async (token) => {
    if (!token) {
      setQrData("");
      return;
    }
    try {
      const qr = await QRCode.toDataURL(token);
      setQrData(qr);
    } catch (err) {
      console.error("Error generating QR code:", err);
    }
  };

  // Handle manual actions (clock in/out, breaks, etc.)
  const handleActionClick = (action) => {
    if (socketRef.current && (employeeId || siteId)) {
      socketRef.current.emit("manual-request", {
        employeeId,
        action,
        siteId,
      });
      setCurrentAction(action);
      setQrData("");
      setShowSetupDialog(true);
      setLimitReached(false);
    }
  };

  // Determine available actions based on employee status
  const getAvailableActions = (status) => {
    if (!status?.clockIn) return ["clockIn"];
    if (status?.clockIn && !status?.breakIn && !status?.clockOut)
      return ["breakIn", "clockOut"];
    if (status?.breakIn && !status?.breakOut) return ["breakOut"];
    if (status?.breakOut && !status?.clockOut) return ["clockOut"];
    return [];
  };

  useEffect(() => {
    if (!socketRef.current) {
      socketRef.current = io(process.env.NEXT_PUBLIC_WEB_URL);

      socketRef.current.on("connect", async () => {
        console.log("Socket connected", socketRef.current.id);
        await refetch();
      });

      socketRef.current.on("new-qr-token", async (token) => {
        await generateQrCode(token);
      });

      socketRef.current.on("refresh-clock-table", async (updatedEmployeeId) => {
        console.log("🔁 Received refresh-clock-table for employee:");

        // Optional: check if this employeeId matches the current employee
        if (!employeeId || updatedEmployeeId === employeeId) {
          await refetch(); // This will re-fetch attendance data
          console.log("📥 Employee data reloaded");
        }
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
      socketRef.current?.disconnect();
      socketRef.current = null;
    };
  }, [loadData, siteId, employeeId, queryClient]);

  // Expose combined attendance list, map, QR code, and helper functions

  return {
    attendanceList,
    attendanceMap,
    qrData,
    limitReached,
    currentAction,
    showSetupDialog,
    setShowSetupDialog,
    handleActionClick,
    getAvailableActions,
    socket: socketRef.current,
    queryKey,
    total,
  };
}
