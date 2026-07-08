import DocumentManagement from "./documentManagement";

export default async function Page({ searchParams }) {
  const param = await searchParams;
  return <DocumentManagement searchParams={param} />;
}
