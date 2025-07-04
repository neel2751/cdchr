"use client";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useFetchQuery } from "@/hooks/use-query";
import { getOneSMTPEmail } from "@/server/email/emailSMTP";

export default function EmailView({ smtpId }) {
  const { data } = useFetchQuery({
    fetchFn: getOneSMTPEmail,
    params: smtpId,
    queryKey: ["oneSMTPEmail"],
  });

  const { newData } = data || {};

  return (
    <Card>
      <CardHeader>
        <CardTitle>Email Details</CardTitle>
        <CardDescription>See all the email deatils</CardDescription>
      </CardHeader>
      <CardContent>{JSON.stringify(newData)}</CardContent>
    </Card>
  );
}
