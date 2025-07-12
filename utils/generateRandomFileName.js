import crypto from "crypto";
import path from "path";

export function generateRandomFileName(originalName) {
  const ext = path.extname(originalName); // get .jpg, .pdf, etc.
  const random = crypto.randomBytes(8).toString("hex");
  return `CDC_${random}${ext}`;
}
