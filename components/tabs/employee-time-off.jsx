import { WeekCalendarWithListEvent } from "../weekendList/weekEndList";

export default function EmployeeTimeOff() {
  return (
    <div className="space-y-8">
      <h2 className="text-xl font-medium">Time Off Overview</h2>
      <p>This tab would show the employee's time off requests and balances.</p>
      <WeekCalendarWithListEvent />
    </div>
  );
}
