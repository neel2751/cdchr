import React, { Suspense } from "react";
import QRCode from "./qrcode";

export default async function QRPage({ searchParams }) {
  const params = await searchParams;

  return (
    <Suspense fallback={<div>Loading QR Code...</div>}>
      <QRCode searchParams={params} />
    </Suspense>
  );
}
