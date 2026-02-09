"use client";
import React, { useState } from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  previewCarryForwardForCompany,
  previewCarryForwardPerCompany,
} from "@/server/leaveServer/countLeaveServer";
import { RefreshCcw } from "lucide-react";
import {
  FilterDataTableBody,
  FilterDataTableHead,
} from "@/components/filterTable/filterTable";
import { Table } from "@/components/ui/table";
import { previewCarryForward } from "@/server/leaveServer/getLeaveServer";

export default function PreviewCarryForwardPage() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);

  const handlePreview = async () => {
    setLoading(true);
    const res = await previewCarryForward({ leaveYear: "2025-26" });
    if (res.success) {
      const data = JSON.parse(res.data);
      setData(data);
    }
    setLoading(false);
  };

  return (
    <div className="p-6 space-y-4">
      <Card>
        <CardHeader className="flex flex-row justify-between items-center">
          <div>
            <CardTitle>Preview Carry Forward</CardTitle>
            <CardDescription>
              Preview the carry forward calculations for all employees in the
              company.
            </CardDescription>
          </div>
          <Button
            onClick={handlePreview}
            disabled={loading}
            title="Preview Carry Forward"
            size={"icon"}
            variant={"outline"}
          >
            {loading ? (
              <RefreshCcw className="animate-spin h-4 w-4" />
            ) : (
              <RefreshCcw className="h-4 w-4" />
            )}
          </Button>
        </CardHeader>
        <CardContent className="pb-6 w-full">
          <div className="space-y-4">
            {/* {data.map((emp, idx) => (
              <div key={idx} className="border p-3 rounded">
                <p className="font-semibold mb-1">
                  Employee: {emp.employeeName}
                </p>
                <p className="text-sm text-gray-600 mb-2 tracking-tight">
                  {emp.leaveYearFrom} → {emp.leaveYearTo}
                </p>
                <Table>
                  <FilterDataTableHead attendanceData={emp.carriedLeaves} />
                  <FilterDataTableBody attendanceData={emp.carriedLeaves} />
                </Table>
              </div>
            ))} */}
            <Table>
              <FilterDataTableHead attendanceData={data} />
              <FilterDataTableBody attendanceData={data} />
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
