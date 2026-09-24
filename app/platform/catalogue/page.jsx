import { redirect } from "next/navigation";

import { getServerSideProps } from "@/server/session/session";
import CatalogueEditor from "./catalogueEditor";

export const metadata = { title: "Tag catalogue" };

/**
 * The price list every customer orders from.
 *
 * Platform-level, so it is maintained here rather than in a seed script
 * somebody has to remember to edit and re-run.
 */
export default async function CataloguePage() {
  const sessionData = await getServerSideProps();
  if (sessionData?.redirect?.destination) {
    redirect(sessionData.redirect.destination);
  }
  if (sessionData?.props?.session?.user?.role !== "platformAdmin") {
    redirect("/unauthorized");
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-6">
      <CatalogueEditor />
    </main>
  );
}
