import AnnouncementManagement from "./announcementManagement";

export default async function Page({ searchParams }) {
  const param = await searchParams;
  return <AnnouncementManagement searchParams={param} />;
}
