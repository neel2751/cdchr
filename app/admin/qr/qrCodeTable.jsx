"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import ViewQrCode from "./viewQrCode";

export default function QrCodeTable({ newData, handleEdit }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Title</TableHead>
          <TableHead>Slug</TableHead>
          <TableHead>Form Title</TableHead>
          <TableHead>Success Message</TableHead>
          <TableHead>Scan Count</TableHead>
          <TableHead>Action</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {newData &&
          newData.map((qrCode) => (
            <TableRow key={qrCode._id}>
              <TableCell>{qrCode.title}</TableCell>
              <TableCell>{qrCode.slug}</TableCell>
              <TableCell>{qrCode.formTitle}</TableCell>
              <TableCell>{qrCode.successMessage}</TableCell>
              <TableCell>{qrCode.scanCount}</TableCell>
              <TableCell>
                <ViewQrCode slug={qrCode.slug} />
              </TableCell>
              <TableCell>
                <button
                  onClick={() => handleEdit(qrCode)}
                  className="text-blue-500 hover:underline"
                >
                  Edit
                </button>
              </TableCell>
            </TableRow>
          ))}
      </TableBody>
    </Table>
  );
}
