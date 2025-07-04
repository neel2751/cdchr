import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  getDepartmentWiseLeaveCount,
  getMonthWiseLeaveCount,
  getMonthWiseLeaveCountWithType,
} from "@/server/leaveServer/leaveReportServer";
import React from "react";
import { LeaveCard } from "../leaveDashboard/leaveCount";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { GlobalForm } from "@/components/form/form";

const LeaveReport = () => {
  return (
    <div className="mt-4">
      <Card>
        <CardHeader>
          <CardTitle>Leave Report</CardTitle>
          <CardDescription>
            This is a leave report for the current month. You can view the leave
            report for previous months by selecting the month from the dropdown
            menu.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid sm:grid-cols-5 grid-cols-3 gap-4">
            <LeaveCard label={"Total"} value={0} />
            <LeaveCard label={"Approved"} value={0} />
            <LeaveCard label={"Pending"} value={0} />
            <LeaveCard label={"Rejected"} value={0} />
            <LeaveCard label={"Date Is Gone"} value={0} />
          </div>

          <div className="grid sm:grid-cols-5 grid-cols-3 gap-4">
            <LeaveCard label={"Total"} value={0} />
            <LeaveCard label={"Approved"} value={0} />
            <LeaveCard label={"Pending"} value={0} />
            <LeaveCard label={"Rejected"} value={0} />
            <LeaveCard label={"Date Is Gone"} value={0} />
          </div>
        </CardContent>
      </Card>
      {/* <div className="mt-10">
        <LeaveReportForm />
      </div> */}
    </div>
  );
};

export default LeaveReport;

const LeaveReportForm = () => {
  const field = [
    {
      labelText: "Select Image",
      name: "image",
      type: "image",
      maxFiles: 1,
      acceptedFileTypes: ["image/png", "image/jpeg", "image/jpg"],
    },
  ];

  const handleSubmit = (data) => {
    console.log(data);
  };

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button>Select Month</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Leave Report</DialogTitle>
          <DialogDescription>
            Select the month for which you want to view the leave report.
          </DialogDescription>
        </DialogHeader>
        <GlobalForm fields={field} onSubmit={handleSubmit} />
      </DialogContent>
    </Dialog>
  );
};
