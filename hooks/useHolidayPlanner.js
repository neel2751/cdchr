import { holidayPlanner } from "@/server/leaveServer/getLeaveServer";
import { useEffect, useState } from "react";

export function useHolidayPlanner({ month, year, teamId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchPlanner();
  }, [month, year, teamId]);

  async function fetchPlanner() {
    const start = new Date(year, month, 1);
    const end = new Date(year, month + 1, 0);
    try {
      setLoading(true);
      const res = await holidayPlanner({ startDate: start, endDate: end });
      const data = res.success ? JSON.parse(res.data) : {};
      const mapped = mapLeavesToCalendar(data || [], start, end);
      setData(mapped);
      setLoading(false);
    } catch (error) {
      setLoading(false);
      console.log("Failed to fetch holiday planner data:", error);
    } finally {
      setLoading(false);
    }
  }

  return { data, loading };
}

export function mapLeavesToCalendar(leaves, startDate, endDate) {
  const calendarMap = {};

  // init empty days
  const current = new Date(startDate);
  while (current <= endDate) {
    const key = current.toISOString().split("T")[0];
    calendarMap[key] = [];
    current.setDate(current.getDate() + 1);
  }

  // explode leaveDates
  for (const leave of leaves) {
    for (const date of leave.leaveDates) {
      const key = new Date(date).toISOString().split("T")[0];

      if (!calendarMap[key]) continue;

      calendarMap[key].push({
        leaveId: leave._id,
        employeeId: leave.employeeId,
        leaveType: leave.leaveType,
        isPaid: leave.isPaid,
        isHalfDay: leave.isHalfDay,
        halfDayType: leave.halfDayType,
      });
    }
  }

  return calendarMap;
}
