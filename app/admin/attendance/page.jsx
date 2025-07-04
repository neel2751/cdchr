import Gretting from "@/components/gretting/gretting";
import AttendanceTable from "./attendanceTable";

export default async function page({ searchParams }) {
  const params = (await searchParams) || {};
  return (
    <div className="p-4 space-y-6">
      <Gretting />
      <AttendanceTable searchParams={params} />
    </div>
  );
}
