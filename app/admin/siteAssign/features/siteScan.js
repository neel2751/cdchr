"use client";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import ScanQrcode from "@/components/2FA/scanQrcode";
import { useCommonContext } from "@/context/commonContext";

export default function QRDialog() {
  const { searchParams } = useCommonContext();
  const siteId = (searchParams && searchParams[0]) || "";
  return (
    <Card className="max-w-xl top-1/2 translate-x-1/2  mt-20">
      <CardHeader>
        <CardTitle>Scan QR Code </CardTitle>
        <CardDescription>
          Scan the QR code using your mobile device to verify your identity.
          <br />
          Make sure to allow camera access for the scanner to work.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ScanQrcode siteId={siteId} />
        {/* <QRCodeSocket /> */}
      </CardContent>
    </Card>
  );
}
