import { CalendarCell } from "./calendarCell";

export default function HolidayCalendar({ calendar }) {
  return (
    <div className="grid grid-cols-7 gap-1">
      {Object.entries(calendar).map(([date, events]) => (
        <CalendarCell key={date} date={date} events={events} />
      ))}
    </div>
  );
}
