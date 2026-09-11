import MyAnnouncements from "./myAnnouncements";

export default async function Page({ searchParams }) {
  const param = await searchParams;
  return <MyAnnouncements searchParams={param} />;
}
