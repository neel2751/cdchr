"use client";
import { GlobalForm } from "@/components/form/form";
import { useCommonContext } from "@/context/commonContext";
import React from "react";

const EmployeeForm = () => {
  const { field, isPending, onSubmit, initialValues } = useCommonContext();

  return (
    <GlobalForm
      fields={field}
      initialValues={initialValues}
      isLoading={isPending}
      onSubmit={onSubmit}
    />
  );
};

export default EmployeeForm;
