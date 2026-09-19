import EmployeeFiles from "@/components/tabs/employee-files";
import ProfileShell from "../_components/profileShell";

export const metadata = { title: "My documents" };

/**
 * Your own documents: the list, and nothing that changes it.
 *
 * `manage` is hardcoded off rather than taken from the shell's capability.
 * Elsewhere in /admin/me the rule is "the capability follows the role, so an
 * HR user loses nothing here" — but documents are the exception, and
 * deliberately. What the company holds about a person is a record HR keeps, not
 * a folder the person keeps: whoever is signed in, this page is the employee's
 * view of their own file and it is read-only. An HR user who needs to add or
 * remove something does it from the employee's record at
 * /admin/officeEmployee/<id>, where it is an HR act with an audit trail
 * attached, instead of quietly from their own profile page.
 */
export default function MyDocumentsPage() {
  return (
    <ProfileShell
      tab="documents"
      render={() => <EmployeeFiles can={{ manage: false }} />}
    />
  );
}
