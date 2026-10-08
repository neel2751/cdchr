import AttendanceTable from "./attendanceTable";

export default async function page({ searchParams }) {
  const params = (await searchParams) || {};
  return (
    <div className="p-4 space-y-6">
      <AttendanceTable searchParams={params} />
    </div>
  );
}
