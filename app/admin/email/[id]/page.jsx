import { decrypt } from "@/lib/algo";
import React from "react";
import EmailDetails from "./emailDetails";

export default async function page({ params }) {
  const { id } = await params;

  const decryptedId = decrypt(id);
  if (!decryptedId) {
    return <div className="p-4">Invalid ID</div>;
  }

  return (
    <div className="p-4 w-full">
      <EmailDetails smtpId={id} />
    </div>
  );
}
