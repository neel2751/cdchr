import AuditLogs from "./auditLogs";

export default async function Home({ searchParams }) {
  const param = await searchParams;
  return <AuditLogs searchParams={param} />;
}
