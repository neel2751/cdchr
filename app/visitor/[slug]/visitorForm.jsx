"use client";

import { GlobalForm } from "@/components/form/form";
import { addLead } from "@/server/leadServer";
import { useRouter } from "next/navigation";
import React from "react";
import { toast } from "sonner";

export default function VisitorForm({ fields, slug }) {
  const router = useRouter();

  const sortedFields = fields.sort((a, b) => a.order - b.order);

  const [isLoading, setIsLoading] = React.useState(false);

  const handleSubmit = async (formData) => {
    try {
      setIsLoading(true);
      const response = await addLead(formData, slug);
      if (response.success) {
        toast.success(response.message || "Form submitted successfully!");
        setTimeout(() => {
          router.push("/visitor/success");
        }, 1500);
      } else {
        toast.error(response.message || "Failed to submit the form.");
      }
    } catch (error) {
      console.log("Error submitting form:", error);
      toast.error("An unexpected error occurred while submitting the form.");
    } finally {
      setIsLoading(false);
    }
  };
  return (
    <GlobalForm
      fields={sortedFields}
      onSubmit={handleSubmit}
      isLoading={isLoading}
      btnName={"Submit"}
      btnProps={{
        className: "bg-orange-500 hover:bg-orange-600 text-white w-full",
      }}
    />
  );
}
