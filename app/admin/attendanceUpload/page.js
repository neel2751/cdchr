import AttendanceUpload from "./attendanceUpload";

export default async function Page({ searchParams }) {
  const param = await searchParams;
  return <AttendanceUpload searchParams={param} />;
}
