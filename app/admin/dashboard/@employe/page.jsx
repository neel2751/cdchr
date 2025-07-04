import React from "react";
import EmployeCard from "../components/employe-card";

export default async function Page({ searchParams }) {
  const param = await searchParams;
  return <EmployeCard param={param} />;
}
