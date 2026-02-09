import { useEffect, useState } from "react";
import {
  CalendarCheck,
  CalendarDaysIcon,
  ChevronLeft,
  ChevronRight,
  Gauge,
  TentTree,
  WandSparkles,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { holidayPlannerNew } from "@/server/leaveServer/getLeaveServer";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { format } from "date-fns";

// ================================
// MAIN COMPONENT
// ================================

export default function HolidayPlannerCalendar() {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [plannerData, setPlannerData] = useState({});

  useEffect(() => {
    fetchPlanner();
  }, [currentMonth]);

  async function fetchPlanner() {
    const start = new Date(
      currentMonth.getFullYear(),
      currentMonth.getMonth(),
      1
    );
    const end = new Date(
      currentMonth.getFullYear(),
      currentMonth.getMonth() + 1,
      0
    );

    const res = await holidayPlannerNew({ startDate: start, endDate: end });
    const data = res.success ? JSON.parse(res.data) : {};
    setPlannerData(data);
  }

  function changeMonth(direction) {
    const newDate = new Date(currentMonth);
    newDate.setMonth(currentMonth.getMonth() + (direction === "next" ? 1 : -1));
    setCurrentMonth(newDate);
  }

  return (
    <Card className="rounded-2xl shadow-sm">
      <CardContent className="p-4">
        <CalendarHeader
          currentMonth={currentMonth}
          onPrev={() => changeMonth("prev")}
          onNext={() => changeMonth("next")}
        />

        <CalendarGrid currentMonth={currentMonth} plannerData={plannerData} />
      </CardContent>
    </Card>
  );
}

// ================================
// HEADER
// ================================

function CalendarHeader({ currentMonth, onPrev, onNext }) {
  return (
    <div className="flex items-center justify-between mb-4">
      <Button variant="outline" size={"icon"} onClick={onPrev}>
        <ChevronLeft />
      </Button>

      <h2 className="text-xl font-semibold tracking-tight text-black/90">
        {currentMonth.toLocaleString("en-GB", {
          month: "long",
          year: "numeric",
        })}
      </h2>

      <Button variant="outline" size={"icon"} onClick={onNext}>
        <ChevronRight />
      </Button>
    </div>
  );
}

// ================================
// GRID
// ================================

function CalendarGrid({ currentMonth, plannerData }) {
  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells = [];

  for (let i = 0; i < firstDay; i++) {
    cells.push(<div key={`empty-${i}`} />);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const dateKey = new Date(year, month, day).toISOString().split("T")[0];

    cells.push(
      <DayCell
        currentMonth={currentMonth}
        key={dateKey}
        day={day}
        leaves={plannerData[dateKey] || []}
      />
    );
  }

  return (
    <div className="grid grid-cols-7 gap-2 text-sm">
      {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
        <div
          key={d}
          className="font-medium text-center text-black tracking-tight border rounded-sm p-1 bg-gray-50"
        >
          {d}
        </div>
      ))}
      {cells}
    </div>
  );
}

// ================================
// DAY CELL
// ================================

function DayCell({ day, leaves, currentMonth }) {
  const currentDay = new Date().getDate();
  return (
    <div className="min-h-[110px] border rounded-xl p-1">
      <div
        className={
          day === currentDay &&
          new Date().getMonth() === currentMonth.getMonth()
            ? "bg-indigo-500 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs font-semibold whitespace-nowrap"
            : "text-gray-800 rounded-full w-6 h-6 flex items-center justify-center text-xs font-semibold whitespace-nowrap"
        }
      >
        {day}
      </div>

      <div className="space-y-1">
        {leaves.map((leave, idx) => (
          <LeaveChip key={idx} leave={leave} day={day} />
        ))}
      </div>
    </div>
  );
}

// ================================
// LEAVE CHIP
// ================================

function LeaveChip({ leave, day }) {
  // const base = "text-[10px] px-2 py-1 rounded-full truncate";
  const base =
    "text-xs text-start px-2 py-1 rounded-sm truncate cursor-pointer";

  const statusStyle =
    leave.leaveType === "Annual Leave"
      ? "bg-green-100 text-green-800 bg-green-100 rounded-sm border-s-4 border-green-800"
      : leave.leaveType === "Unpaid Leave"
      ? "bg-yellow-100 text-yellow-800 bg-yellow-100 rounded-sm border-s-4 border-yellow-800"
      : "bg-purple-100 text-purple-800 bg-purple-100 rounded-sm border-s-4 border-purple-800";

  return (
    <Dialog>
      <DialogTrigger asChild>
        <div className={`${base} ${statusStyle}`}>
          {leave.employeeName} - {leave.leaveType}
          {leave.isHalfDay && (
            <span className="ml-1 font-bold">({leave.halfDayType})</span>
          )}
        </div>
      </DialogTrigger>
      <DialogContent className="max-w-full sm:max-w-lg">
        <DialogHeader>
          <DialogTitle
            className={"font-semibold tracking-tight text-neutral-800"}
          >
            {leave.employeeName} - {leave.leaveType} Details
          </DialogTitle>
          <DialogDescription>
            Detailed information about the leave request.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <div className="space-y-3">
            <dl className="flex flex-col sm:flex-row gap-1">
              <dt className="min-w-40">
                <span className=" inline-flex text-sm text-muted-foreground items-center">
                  <CalendarCheck className=" me-1 h-4 w-4" />
                  Submitted On
                </span>
              </dt>
              <dd>
                <ul>
                  <li className="me-1 after:content-[','] inline-flex items-center text-sm text-foreground">
                    <span className="whitespace-nowrap text-neutral-900 font-medium">
                      {format(new Date(leave.leaveSubmitDate), "PPP")}
                    </span>
                  </li>
                </ul>
              </dd>
            </dl>
            <dl className="flex flex-col sm:flex-row gap-1">
              <dt className="min-w-40">
                <span className="inline-flex text-sm text-muted-foreground items-center">
                  <TentTree className="me-1 h-4 w-4" />
                  Leave Type
                </span>
              </dt>
              <dd>
                <ul>
                  <li className="me-1 after:content-[','] inline-flex items-center text-sm text-foreground">
                    <span className="whitespace-nowrap text-neutral-900 font-medium">
                      {leave.leaveType}
                    </span>
                  </li>
                </ul>
              </dd>
            </dl>
            <dl className="flex flex-col sm:flex-row gap-1">
              <dt className="min-w-40">
                <span className=" inline-flex text-sm text-muted-foreground items-center">
                  <WandSparkles className=" me-1 h-4 w-4" />
                  Leave Status
                </span>
              </dt>
              <dd>
                <ul>
                  <li className="me-1 after:content-[','] inline-flex items-center text-sm text-foreground">
                    <span className="whitespace-nowrap text-neutral-900 font-medium">
                      {leave.status}
                    </span>
                  </li>
                </ul>
              </dd>
            </dl>
            <dl className="flex flex-col sm:flex-row gap-1">
              <dt className="min-w-40">
                <span className="inline-flex text-sm text-muted-foreground items-center">
                  <CalendarDaysIcon className=" me-1 h-4 w-4" />
                  Leave Dates
                </span>
              </dt>
              <dd>
                <ul>
                  <li className="me-1 inline-flex items-center text-sm text-foreground">
                    <span className=" text-neutral-900 font-medium">
                      {leave.leaveDates.map((date, idx) => (
                        <span key={idx}>
                          {format(new Date(date), "PPP")}
                          {idx < leave.leaveDates.length - 1 ? ", " : ""}
                        </span>
                      ))}
                    </span>
                  </li>
                </ul>
              </dd>
            </dl>
            {leave.isHalfDay && (
              <dl className="flex flex-col sm:flex-row gap-1">
                <dt className="min-w-40">
                  <span className="inline-flex text-sm text-muted-foreground items-center">
                    <Gauge className=" me-1 h-4 w-4" />
                    Half Day Type
                  </span>
                </dt>
                <dd>
                  <ul>
                    <li className="me-1 inline-flex items-center text-sm text-foreground">
                      <span className="whitespace-nowrap text-neutral-900 font-medium">
                        {leave.halfDayType}
                      </span>
                    </li>
                  </ul>
                </dd>
              </dl>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
