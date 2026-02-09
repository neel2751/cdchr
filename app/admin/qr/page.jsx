import React, { Suspense } from "react";
import QRCode from "./qrcode";

export default function QRPage() {
  return (
    <Suspense fallback={<div>Loading QR Code...</div>}>
      <QRCode />
    </Suspense>
  );
}
