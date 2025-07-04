import React from "react";
import SMTPConfig from "./SMTPConfig";

export default function page() {
  const queryKey = ["getAllSMTPsAdvance"];

  return (
    <div className="p-4">
      <SMTPConfig queryKey={queryKey} />
    </div>
  );
}
