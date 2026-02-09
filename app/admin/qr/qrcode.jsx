"use client";
import React from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import SearchDebounce from "@/components/filters/search/search-debounce";
import QrCodeTable from "./qrCodeTable";
import CreateQrCode from "./createQrCode";
import { useFetchQuery } from "@/hooks/use-query";
import { getAllQrCodes } from "@/server/QrCodeServer/qrServer";

export default function QRCode({ searchParams }) {
  const [open, setOpen] = React.useState(false);
  const [initialValues, setInitialValues] = React.useState(null);

  const { data } = useFetchQuery({
    fetchFn: getAllQrCodes,
    queryKey: ["qrCodeList"],
  });
  const { newData } = data || {};

  const handleEdit = (qrCode) => {
    const imageUrl = qrCode?.mediaId.url;
    qrCode = {
      ...qrCode,
      image: imageUrl,
    };

    setInitialValues(qrCode);
    setOpen(true);
  };

  return (
    <div className="p-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Visitor QR Codes</CardTitle>
              <CardDescription>
                Generate and manage QR codes for visitor registration
              </CardDescription>
            </div>
            <Button onClick={() => setOpen(true)} className="mb-4">
              Add Visitor
            </Button>
          </div>
          <SearchDebounce />
        </CardHeader>
        <CardContent>
          <QrCodeTable newData={newData} handleEdit={handleEdit} />
        </CardContent>
      </Card>
      <CreateQrCode
        open={open}
        onOpenChange={setOpen}
        initialValues={initialValues}
        title={"Generate Visitor QR Code"}
        description={
          "Create a QR code for visitors to scan and fill out their details."
        }
      />
    </div>
  );
}
