import React from "react";
import { ConsultationBooking } from "../hr/booking";

export default async function Page({ searchParams }) {
  const { name } = await searchParams;
  return <ConsultationBooking />;
}
