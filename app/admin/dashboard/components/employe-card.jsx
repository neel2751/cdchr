"use client";
import CardName from "../../_components/name";
import QRCodeSocket from "@/components/2FA/qrcodesocket";
import ClockData from "./clockData";

export default function EmployeCard({ param }) {
  return (
    <div className="container mx-auto p-4 space-y-4">
      <CardName />
      <ClockData serachParams={param} />
      <div className="max-w-xl mx-auto mt-20">
        <QRCodeSocket />
      </div>
    </div>
  );
}
