import Employee from "../employee/employee";

// Previous (inactive) field employees. Reuses the Employee List screen in its
// "previous" variant, which locks the list to inactive staff and hides the Add
// button / status filter.
export default async function PreviousEmployeePage({ searchParams }) {
  const param = await searchParams;
  return <Employee searchParams={param} variant="previous" />;
}
