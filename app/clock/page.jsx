import { redirect } from "next/navigation";

import { getServerSideProps } from "@/server/session/session";
import TapToClock from "./tapToClock";

export const metadata = { title: "Clock in" };

/**
 * Where an NFC tap lands.
 *
 * The tag holds a plain URL — `https://<host>/clock?tag=<uid>` — because that
 * is the one thing both platforms handle with no app installed. An iPhone
 * (XS or later, iOS 14+) reads the tag in the background and offers a banner
 * that opens it in Safari; Android does the same. Anything cleverer, Web NFC
 * included, is Chrome-on-Android only and cannot be the baseline.
 *
 * An NTAG 424 DNA chip appends `picc` and `cmac` on every tap: its UID and
 * counter, encrypted, plus a signature over them. That is the replay defence,
 * and it only works because the counter arrives inside something signed — a
 * counter in the query string is a number anybody can edit. A plain NTAG213
 * sends neither, which is why a 213 wants a geofence beside it.
 */
export default async function ClockPage({ searchParams }) {
  const params = await searchParams;
  const uid = typeof params?.tag === "string" ? params.tag : "";
  // What an NTAG 424 DNA chip appends on every tap: its encrypted UID and
  // counter, and a CMAC over them. A plain NTAG213 sends neither.
  const picc = typeof params?.picc === "string" ? params.picc : "";
  const cmac = typeof params?.cmac === "string" ? params.cmac : "";

  const sessionData = await getServerSideProps();
  if (sessionData?.redirect?.destination) {
    // Straight back here after signing in, so a tap on a locked-out phone is
    // one extra step rather than a dead end.
    const back = encodeURIComponent(
      `/clock?tag=${encodeURIComponent(uid)}` +
        (picc ? `&picc=${encodeURIComponent(picc)}` : "") +
        (cmac ? `&cmac=${encodeURIComponent(cmac)}` : ""),
    );
    redirect(`/auth?callbackUrl=${back}`);
  }

  return (
    <main className="mx-auto w-full max-w-sm px-3 py-6">
      <TapToClock uid={uid} picc={picc} cmac={cmac} />
    </main>
  );
}
