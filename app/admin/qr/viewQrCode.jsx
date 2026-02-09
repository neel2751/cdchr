import QrGenerator from "@/components/QrCode/QrGenerator";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import React from "react";

export default function ViewQrCode({ slug }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline">View QR Code</Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Visitor QR Code</DialogTitle>
          <DialogDescription>
            Scan this QR code to access the visitor form.
          </DialogDescription>
        </DialogHeader>
        <QrGenerator slug={slug} />
      </DialogContent>
    </Dialog>
  );
}
