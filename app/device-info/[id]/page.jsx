import { DeviceInformationForm } from "@/components/deviceInfo/deviceInfo";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Send } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import React from "react";

const ids = ["MjycfQWvALeoEJ22bbhKX+2jzuwUBM2DQlGWl7D+nIo="];

export default async function page({ params }) {
  const { id } = await params;
  // find id
  const decodeId = decodeURIComponent(id);
  const match = ids.includes(decodeId);

  return (
    <div>
      {match ? (
        <DeviceInformationForm />
      ) : (
        <Card className={"max-w-xl mx-auto mt-20"}>
          <CardHeader className={"space-y-4 text-center"}>
            <div className="w-full">
              <Image
                src={"/images/1.svg"}
                alt="test"
                height={200}
                width={200}
                className="object-contain w-full rounded-xl"
              />
            </div>
            <CardTitle>Form Submission Window Closed 📫</CardTitle>
            <CardDescription>
              We're sorry, but the deadline for submitting this form has passed.
              To ensure we collect the most up-to-date information, the original
              link is no longer active.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-4">
              <p className="text-base tracking-tight font-medium text-neutral-600">
                Our records indicate that the two-day submission period for this
                form has concluded. If you still need to complete the form, you
                can request a new link, and we will send one to you as soon as
                possible. Please note that a new submission period will apply to
                the newly generated link.
              </p>

              <span className="text-sm font-normal text-gray-500 tracking-tight">
                Note*: Please metion your name & email when do request new form
                link
              </span>
              <Button className={"bg-purple-800"} asChild>
                <Link href={"mailto:neel@cdc.construction"}>
                  <Send />
                  Request New Form Link
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
