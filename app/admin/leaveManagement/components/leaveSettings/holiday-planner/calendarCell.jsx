export function CalendarCell({ date, events }) {
  return (
    <div className="border min-h-[90px] p-1 text-xs">
      <div className="font-semibold">{new Date(date).getDate()}</div>

      <div className="space-y-1 mt-1">
        {events.map((e, i) => (
          <div
            key={i}
            className={`rounded px-1 ${
              e.leaveType === "Annual Leave"
                ? "bg-blue-100 text-blue-800"
                : e.leaveType === "Unpaid Leave"
                ? "bg-red-100 text-red-800"
                : "bg-purple-100 text-purple-800"
            }`}
          >
            {e.leaveType}
            {e.isHalfDay && ` (½ ${e.halfDayType})`}
          </div>
        ))}
      </div>
    </div>
  );
}
