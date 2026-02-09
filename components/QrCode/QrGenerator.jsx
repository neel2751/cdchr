"use client";
import Image from "next/image";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { Download, FileCode, CheckCircle2 } from "lucide-react";

export default function QrGenerator({ slug }) {
  const downloadUrl = `${process.env.NEXT_PUBLIC_WEB_URL}/visitor/${slug}`;
  const [previewData, setPreviewData] = useState("");

  useEffect(() => {
    // Generate standard preview
    QRCode.toDataURL(downloadUrl, { width: 300, margin: 2 }).then(
      setPreviewData
    );
  }, [slug]);

  // --- PNG DOWNLOAD (1200px High-Res) ---
  const downloadPNG = async () => {
    const dataUrl = await QRCode.toDataURL(downloadUrl, {
      width: 1200,
      margin: 1,
      errorCorrectionLevel: "H",
    });
    triggerDownload(dataUrl, `QR_${slug}.png`);
  };

  // --- SVG DOWNLOAD (Vector - Unlimited Resolution) ---
  const downloadSVG = async () => {
    try {
      // Generate the raw SVG string
      const svgString = await QRCode.toString(downloadUrl, {
        type: "svg",
        margin: 1,
        errorCorrectionLevel: "H",
        color: { dark: "#000000", light: "#ffffff" },
      });

      // Convert string to a downloadable Blob
      const blob = new Blob([svgString], { type: "image/svg+xml" });
      const url = URL.createObjectURL(blob);
      triggerDownload(url, `QR_${slug}.svg`);
      URL.revokeObjectURL(url); // Clean up memory
    } catch (err) {
      console.error("SVG Generation failed", err);
    }
  };

  const triggerDownload = (url, fileName) => {
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="flex flex-col items-center p-4  border rounded-3xl shadow-xl">
      <div className="relative group">
        <div className="bg-gradient-to-tr from-indigo-500 to-purple-500 p-1 rounded-2xl shadow-lg">
          <div className="bg-white p-3 rounded-xl">
            {previewData && (
              <Image
                src={previewData}
                alt="QR"
                width={200}
                height={200}
                className="w-44 h-44"
              />
            )}
          </div>
        </div>
      </div>

      <div className="mt-6 w-full space-y-3">
        {/* SVG is the "Pro" option */}
        <button
          onClick={downloadSVG}
          className="w-full flex items-center justify-between bg-emerald-50 text-emerald-700 p-4 rounded-2xl font-bold hover:bg-emerald-100 transition-all border border-emerald-200"
        >
          <div className="flex items-center gap-3">
            <FileCode className="w-5 h-5" />
            <div className="text-left">
              <p className="text-sm">Download SVG</p>
              <p className="text-[10px] font-normal opacity-70">
                Best for Large Printing/Canva
              </p>
            </div>
          </div>
          <CheckCircle2 className="w-4 h-4 opacity-50" />
        </button>

        {/* PNG is the standard option */}
        <button
          onClick={downloadPNG}
          className="w-full flex items-center justify-between bg-gray-50 text-gray-700 p-4 rounded-2xl font-bold hover:bg-gray-100 transition-all border border-gray-200"
        >
          <div className="flex items-center gap-3">
            <Download className="w-5 h-5" />
            <div className="text-left">
              <p className="text-sm">Download PNG</p>
              <p className="text-[10px] font-normal opacity-70">
                1200px High Resolution
              </p>
            </div>
          </div>
        </button>
      </div>

      <p className="mt-6 text-[11px] font-mono text-gray-400 break-all text-center">
        {downloadUrl}
      </p>
    </div>
  );
}
