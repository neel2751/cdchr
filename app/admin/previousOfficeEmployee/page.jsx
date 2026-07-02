import OfficeEmplyee from "../officeEmployee/officeEmplyee";

// Previous (inactive) office employees. Reuses the Office Management screen in
// its "previous" variant, which locks the list to inactive staff and hides the
// Add button / status filter.
export default async function PreviousOfficeEmployeePage({ searchParams }) {
  const param = await searchParams;
  return <OfficeEmplyee searchParams={param} variant="previous" />;
}
