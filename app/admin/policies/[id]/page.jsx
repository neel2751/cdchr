import PolicyDetail from "./policyDetail";

export default async function Page({ params }) {
  const { id } = await params;
  return (
    <div className="p-4">
      <PolicyDetail id={id} />
    </div>
  );
}
