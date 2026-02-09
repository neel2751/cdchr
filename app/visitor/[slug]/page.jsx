import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getQrCodeBySlug } from "@/server/QrCodeServer/qrServer";
import VisitorForm from "./visitorForm";
import Image from "next/image";
import VisitorCTA from "./cta";

export default async function page({ params }) {
  const { slug } = await params;

  const data = await getQrCodeBySlug(slug);

  if (!data.success) {
    return (
      <div className="p-4">
        <Card>
          <CardHeader>
            <CardTitle>Visitor QR Code Details</CardTitle>
            <CardDescription>Details for QR Code: Not Found</CardDescription>
          </CardHeader>
          <CardContent>
            <p>No QR Code found for the provided slug.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const qrData = data?.data || null;

  if (!qrData) {
    return (
      <div className="p-4">
        <Card>
          <CardHeader>
            <CardTitle>Visitor QR Code Details</CardTitle>
            <CardDescription>Details for QR Code: Not Found</CardDescription>
          </CardHeader>
          <CardContent>
            <p>No QR Code found for the provided slug.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!qrData?.templateDetails?.fields) {
    return (
      <div className="p-4">
        <Card>
          <CardHeader>
            <CardTitle>{`Visitor QR Code Details for ${qrData.title}`}</CardTitle>
            <CardDescription>
              {`Details for QR Code: ${qrData?.slug}`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p>
              No fields found for this QR code. Please contact the
              administrator.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4">
      <Card className={"container mx-auto"}>
        <CardHeader className="text-center flex flex-col items-center justify-center">
          <Image
            src={qrData?.mediaDetails?.url || "/placeholder-image.png"}
            alt={qrData.title}
            width={200}
            height={100}
            title={qrData.title}
            className="w-full max-w-sm rounded-lg mb-4 size-full max-h-20 object-contain"
          />
          <div className="space-y-1">
            <CardTitle>
              {qrData?.formTitle ||
                `Visitor QR Code Details for ${qrData.title}`}
            </CardTitle>
            <CardDescription>
              Please fill out the form below to check in.{" "}
              {qrData?.successMessage || ""}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {/* {JSON.stringify(qrData)} */}
          <VisitorForm fields={qrData.templateDetails.fields} slug={slug} />
        </CardContent>
        <CardFooter className="border-t flex items-center justify-center">
          <VisitorCTA />
        </CardFooter>
      </Card>
    </div>
  );
}
