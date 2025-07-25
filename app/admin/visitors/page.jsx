import React from "react";
import Visitor from "./visitor";

export default async function page({ searchParams }) {
  const searchParam = await searchParams;
  return <Visitor searchParams={searchParam} />;
}
