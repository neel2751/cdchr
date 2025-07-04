"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { format } from "date-fns";
import { CalendarIcon, PlusCircle, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export default function LeaveRequests() {
  const [leaveRequests, setLeaveRequests] = useState([
    {
      id: "1",
      type: "Vacation",
      startDate: new Date(2024, 6, 15),
      endDate: new Date(2024, 6, 22),
      reason: "Annual family vacation",
      status: "approved",
      requestedOn: new Date(2024, 5, 10),
    },
    {
      id: "2",
      type: "Sick Leave",
      startDate: new Date(2024, 4, 3),
      endDate: new Date(2024, 4, 5),
      reason: "Flu",
      status: "approved",
      requestedOn: new Date(2024, 4, 2),
    },
    {
      id: "3",
      type: "Personal Leave",
      startDate: new Date(2024, 7, 10),
      endDate: new Date(2024, 7, 12),
      reason: "Family commitment",
      status: "pending",
      requestedOn: new Date(2024, 6, 25),
    },
  ]);

  const [showNewRequestForm, setShowNewRequestForm] = useState(false);
  const [startDate, setStartDate] = useState(new Date());
  const [endDate, setEndDate] = useState(new Date());
  const [leaveType, setLeaveType] = useState("Vacation");
  const [reason, setReason] = useState("");

  const handleSubmitRequest = () => {
    if (!startDate || !endDate || !leaveType || !reason) return;

    const newRequest = {
      id: Math.random().toString(36).substring(7),
      type: leaveType,
      startDate,
      endDate,
      reason,
      status: "pending",
      requestedOn: new Date(),
    };

    setLeaveRequests([newRequest, ...leaveRequests]);
    setShowNewRequestForm(false);
    setStartDate(new Date());
    setEndDate(new Date());
    setLeaveType("Vacation");
    setReason("");
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-xl font-medium">Leave Requests</h2>
          <p className="text-muted-foreground">
            Manage your leave requests and check balances
          </p>
        </div>
        <Button onClick={() => setShowNewRequestForm(!showNewRequestForm)}>
          <PlusCircle className="h-4 w-4 mr-2" />
          New Request
        </Button>
      </div>

      {showNewRequestForm && (
        <Card>
          <CardHeader>
            <CardTitle>New Leave Request</CardTitle>
            <CardDescription>
              Submit a new leave request for approval
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="leave-type">Leave Type</Label>
                <Select value={leaveType} onValueChange={setLeaveType}>
                  <SelectTrigger id="leave-type">
                    <SelectValue placeholder="Select leave type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Vacation">Vacation</SelectItem>
                    <SelectItem value="Sick Leave">Sick Leave</SelectItem>
                    <SelectItem value="Personal Leave">
                      Personal Leave
                    </SelectItem>
                    <SelectItem value="Bereavement">Bereavement</SelectItem>
                    <SelectItem value="Parental Leave">
                      Parental Leave
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Start Date</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "w-full justify-start text-left font-normal",
                        !startDate && "text-muted-foreground"
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {startDate ? format(startDate, "PPP") : "Select date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0">
                    <Calendar
                      mode="single"
                      selected={startDate}
                      onSelect={setStartDate}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
              </div>

              <div className="space-y-2">
                <Label>End Date</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "w-full justify-start text-left font-normal",
                        !endDate && "text-muted-foreground"
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {endDate ? format(endDate, "PPP") : "Select date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0">
                    <Calendar
                      mode="single"
                      selected={endDate}
                      onSelect={setEndDate}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="reason">Reason for Leave</Label>
              <Textarea
                id="reason"
                placeholder="Provide details about your leave request"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>
          </CardContent>
          <CardFooter className="flex justify-between">
            <Button
              variant="outline"
              onClick={() => setShowNewRequestForm(false)}
            >
              Cancel
            </Button>
            <Button onClick={handleSubmitRequest}>Submit Request</Button>
          </CardFooter>
        </Card>
      )}

      <div className="grid grid-cols-3 gap-4 mb-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">
              Vacation Leave
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">14 days</div>
            <p className="text-xs text-muted-foreground">Remaining balance</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Sick Leave</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">7 days</div>
            <p className="text-xs text-muted-foreground">Remaining balance</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">
              Personal Leave
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">3 days</div>
            <p className="text-xs text-muted-foreground">Remaining balance</p>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        <h3 className="text-lg font-medium">
          Leave History & Pending Requests
        </h3>
        {leaveRequests.map((request) => (
          <div key={request.id} className="border rounded-md p-4">
            <div className="flex justify-between items-start">
              <div>
                <div className="flex items-center gap-2">
                  <h4 className="font-medium">{request.type}</h4>
                  <span
                    className={cn(
                      "text-xs px-2 py-0.5 rounded-full",
                      request.status === "approved" &&
                        "bg-green-100 text-green-800",
                      request.status === "pending" &&
                        "bg-yellow-100 text-yellow-800",
                      request.status === "rejected" && "bg-red-100 text-red-800"
                    )}
                  >
                    {request.status.charAt(0).toUpperCase() +
                      request.status.slice(1)}
                  </span>
                </div>
                <p className="text-sm">
                  {format(request.startDate, "PPP")} -{" "}
                  {format(request.endDate, "PPP")}
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  {request.reason}
                </p>
                <p className="text-xs text-muted-foreground mt-2">
                  Requested on {format(request.requestedOn, "PPP")}
                </p>
              </div>

              {request.status === "pending" && (
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-red-500"
                  >
                    <X className="h-4 w-4 mr-1" />
                    Cancel
                  </Button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
