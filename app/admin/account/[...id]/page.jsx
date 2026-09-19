import { redirect } from "next/navigation";
import { decrypt } from "@/lib/algo";
import { getServerSideProps } from "@/server/session/session";

/**
 * What /admin/account/<encrypted-id>/<tab> has become.
 *
 * The page that used to live here showed a person their own record, and named
 * that record in the URL to do it. The id was never load-bearing — the server
 * actions behind the page pin anyone without a staff-management permission to
 * their own record whatever id they send — so it only ever put an identifier in
 * the address bar and let somebody wonder whose it was.
 *
 * Two kinds of link arrive here, and they are not the same request:
 *
 *   - your own id, from the avatar menu or a bookmark, which means "my
 *     profile" and now goes to /admin/me;
 *   - somebody else's, which only HR ever had, and which means "this
 *     employee's record" — that is /admin/officeEmployee/<id>, the page it
 *     always should have been, still permission-checked there.
 *
 * Decrypting has to happen here rather than in proxy.js: lib/algo.js needs
 * node's crypto, and the middleware runs on the edge runtime.
 */
export default async function AccountRedirect({ params }) {
  const segments = (await params).id || [];
  const [encryptedId, ...rest] = segments;

  const sessionData = await getServerSideProps();
  if (sessionData?.redirect?.destination) {
    redirect(sessionData.redirect.destination);
  }
  const ownId = sessionData?.props?.session?.user?._id;
  if (!ownId) redirect("/unauthorized");

  let requestedId = null;
  try {
    requestedId = encryptedId ? decrypt(encryptedId) || null : null;
  } catch {
    requestedId = null;
  }

  if (!requestedId || String(requestedId) === String(ownId)) {
    redirect(`/admin/me/${mapTab(rest[0])}`);
  }

  // Someone else's record. The tab names differ between the two areas, so this
  // hands over the employee and lets that page open on its own default rather
  // than guessing at a tab that may not exist there.
  redirect(`/admin/officeEmployee/${encryptedId}/overview`);
}

/**
 * Old account tab -> where that content lives now.
 *
 * The tabs that vanished did not lose their content, they lost their place:
 * attendance, the rota and leave are sidebar destinations now, and "edit" is
 * gone because an employee reads their own record rather than editing it.
 */
function mapTab(tab) {
  switch (tab) {
    case "document":
      return "documents";
    case "password":
    case "session":
      return "security";
    case "attendance":
      return "attendance";
    case "weeklyrota":
      return "shifts";
    case "leave":
    case "bankholiday":
      return "leave";
    default:
      return "profile";
  }
}
