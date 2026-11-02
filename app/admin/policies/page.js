import PolicyLibrary from "./policyLibrary";

export default async function Page({ searchParams }) {
  const param = await searchParams;
  return <PolicyLibrary searchParams={param} />;
}
