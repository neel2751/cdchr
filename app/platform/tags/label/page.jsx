import { redirect } from "next/navigation";

import { getServerSideProps } from "@/server/session/session";
import LabelSheet from "./labelSheet";

export const metadata = { title: "Dispatch label" };

/**
 * A printable dispatch label for one shipment.
 *
 * A page rather than a dialog because printing a dialog prints the page behind
 * it — and because the operator wants this open on its own while they pack,
 * not layered over the station they are working in.
 *
 * Reached as /platform/tags/label?order=TAG-...&shipment=TAG-.../1
 */
export default async function DispatchLabelPage({ searchParams }) {
  const sessionData = await getServerSideProps();
  if (sessionData?.redirect?.destination) {
    redirect(sessionData.redirect.destination);
  }
  if (sessionData?.props?.session?.user?.role !== "platformAdmin") {
    redirect("/unauthorized");
  }

  const { order, shipment } = await searchParams;
  if (!order || !shipment) {
    return (
      <main className="mx-auto w-full max-w-xl px-4 py-6">
        <p className="text-sm text-neutral-500">
          No shipment named. Open a label from the provisioning station.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6">
      <LabelSheet orderNumber={order} reference={shipment} />
    </main>
  );
}
