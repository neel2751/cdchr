import { ColumnCalendar } from "./column-calendar";

const employee = {
  id: "emp_123",
  name: "Neel Patel",
  title: "Software Engineer",
  schedule: {
    startTime: "09:00",
    endTime: "17:00",
    workDays: [1, 2, 3, 4, 5, 6], // Mon-Sat
  },
};

export default function RequestOff() {
  return (
    <ColumnCalendar
      employee={employee}
      onRequestSubmit={async (request) => {
        console.log("Time off request:", request);
        // Calculate total hours
        const start = new Date(`2000-01-01T${request.timeRange.start}`);
        const end = new Date(`2000-01-01T${request.timeRange.end}`);
        const totalHours = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
        console.log(`Total hours requested: ${totalHours}`);
        // Handle the request submission here
      }}
    />
  );
}
