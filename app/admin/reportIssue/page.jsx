import ReportIssue from "./reportIssue";

export default async function Home({ searchParams }) {
  const param = await searchParams;
  return <ReportIssue searchParams={param} />;
}
