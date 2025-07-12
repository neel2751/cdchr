import Expense from "@/app/(feature)/Expense/Expense";
import React from "react";

export default async function page({ searchParams }) {
  const params = await searchParams;
  return <Expense searchParams={params} />;
}
