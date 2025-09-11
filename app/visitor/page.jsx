import React from "react";
import { ConsultationBooking } from "../office/booking";

export default async function Page({ searchParams }) {
  const { name } = await searchParams;
  return <ConsultationBooking />;
}
