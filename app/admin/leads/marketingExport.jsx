// components/admin/MarketingExport.jsx
"use client";
import { useState } from "react";
import { Download } from "lucide-react";
import { exportMarketing } from "@/server/leadServer";
import { Button } from "@/components/ui/button";

export default function MarketingExport() {
  const [isExporting, setIsExporting] = useState(false);

  const downloadCSV = async () => {
    try {
      setIsExporting(true);
      const res = await exportMarketing();
      const json = JSON.parse(res.data);

      // Convert JSON to CSV string
      const headers = Object.keys(json[0]).join(",");
      const rows = json.map((row) =>
        Object.values(row)
          .map((value) => `"${value}"`)
          .join(",")
      );
      const csvContent = [headers, ...rows].join("\n");

      // Trigger Browser Download
      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.setAttribute(
        "download",
        `Marketing_Leads_${new Date().toLocaleDateString()}.csv`
      );
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setIsExporting(false);
    } catch (error) {
      console.log("Error exporting marketing data:", error);
      setIsExporting(false);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <Button
      onClick={downloadCSV}
      disabled={isExporting}
      className="bg-indigo-600 px-4 py-2 font-semibold flex items-center gap-2 hover:bg-indigo-50 transition-all active:scale-95 disabled:opacity-50"
    >
      {isExporting ? (
        "Processing..."
      ) : (
        <>
          <Download className="w-5 h-5" /> Export for Mailchimp
        </>
      )}
    </Button>
  );
}
