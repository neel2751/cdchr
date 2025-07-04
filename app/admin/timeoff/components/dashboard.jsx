import TimeInfo from "./time-info";
import SiteInfo from "./site-info";
import EmployeeTableTimeOff from "./employee-table";

export default function Dashboard() {
  return (
    <div className="space-y-6">
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        <TimeInfo />
        <SiteInfo />
      </div>
      <EmployeeTableTimeOff />
    </div>
  );
}
