"use client";
import {
  fetchAssignedWithClocksNew,
  fetchClockRecordsTest,
} from "@/server/siteAssignmentServer/siteAssignmentServer";
// hooks/useAttendanceSocket.js
import {
  fetchLiveOfficeClock,
} from "@/server/timeOffServer/timeOffServer";
import { useEffect, useRef, useState, useCallback } from "react";
import { io } from "socket.io-client";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { decrypt } from "@/lib/algo";

const OBJECT_ID_REGEX = /^[a-f\d]{24}$/i;

function resolveSiteId(siteId) {
  if (!siteId || siteId === "All") return null;

  if (OBJECT_ID_REGEX.test(siteId)) {
    return siteId;
  }

  try {
    const decrypted = decrypt(siteId);
    return OBJECT_ID_REGEX.test(decrypted) ? decrypted : null;
  } catch {
    return null;
  }
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

  const [total, setTotal] = useState();
  const [summary, setSummary] = useState({
    totalEmployees: 0,
    presentToday: 0,
    onBreak: 0,
    clockedOut: 0,
    averageMinutes: 0,
  });

  const loadData = useCallback(
    async ({
      siteId,
      employeeId,
      currentPage,
      pagePerData,
      query,
      fromDate,
      toDate,
    }) => {
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
        if (!res.success) {
          toast.error(res.message || "Failed to load attendance data");
          return null;
        }
        const data = res?.data ? JSON.parse(res.data) : {}; // Fallback to {} instead of crashing
        setTotal(res.totalCount);
        setSummary(
          res.summary || {
            totalEmployees: 0,
            presentToday: 0,
            onBreak: 0,
            clockedOut: 0,
            averageMinutes: 0,
          },
        );
        return data;
      } catch (err) {
        console.log("❌ Error fetching clock data:", err);
        toast.error("Failed to load attendance data");
        return null;
      }
    },
    [],
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

  // const attendanceList = Object.values(attendanceMap || {}).flat();
  // This prevents the "Cannot convert undefined to object" error permanently
  const attendanceList = attendanceMap
    ? Object.values(attendanceMap).flat()
    : [];



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


      socketRef.current.on("refresh-clock-table", async (updatedEmployeeId) => {
        console.log("🔁 Received refresh-clock-table for employee:");

        // Optional: check if this employeeId matches the current employee
        if (!employeeId || updatedEmployeeId === employeeId) {
          await refetch(); // This will re-fetch attendance data
          console.log("📥 Employee data reloaded");
        }
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
    getAvailableActions,
    queryKey,
    socket: socketRef.current,
    total,
    summary,
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
  const siteOId = resolveSiteId(siteId);
  const queryKey = [
    "siteClock",
    { siteOId, employeeId, query, currentPage, pagePerData, fromDate, toDate },
  ];
  const [total, setTotal] = useState();
  const [summary, setSummary] = useState({
    totalEmployees: 0,
    presentToday: 0,
    onBreak: 0,
    clockedOut: 0,
    averageMinutes: 0,
  });
  // Load attendance data based on passed params (siteId or employeeId)
  const loadData = useCallback(
    async ({
      employeeId,
      currentPage,
      pagePerData,
      query,
      fromDate,
      toDate,
    }) => {
      try {
        const res = await fetchAssignedWithClocksNew({
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
        setSummary(
          res.summary || {
            totalEmployees: 0,
            presentToday: 0,
            onBreak: 0,
            clockedOut: 0,
            averageMinutes: 0,
          },
        );
        const map = {};

        data?.forEach((item) => {
          const empId = item?.employeeId;
          if (!empId) return;
          if (!map[empId]) map[empId] = [];
          map[empId].push(item);
        });

        return map;
      } catch (err) {
        console.log("❌ Error fetching clock data:", err);
        toast.error("Failed to load attendance data");
        return null;
      }
    },
    [siteOId],
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


      socketRef.current.on("refresh-clock-table", async (updatedEmployeeId) => {
        console.log("🔁 Received refresh-clock-table for employee:");

        // Optional: check if this employeeId matches the current employee
        if (!employeeId || updatedEmployeeId === employeeId) {
          await refetch(); // This will re-fetch attendance data
          console.log("📥 Employee data reloaded");
        }
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
    getAvailableActions,
    socket: socketRef.current,
    queryKey,
    total,
    summary,
  };
}
