"use client";
import React, { useState } from "react";
import {
  Clock,
  MapPin,
  Users,
  Trash2,
  CheckCircle,
  Coffee,
  LogOut,
  EditIcon,
  XIcon,
  SaveIcon,
  QrCodeIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import TableHeaderCom from "@/components/tableStatus/tableHeader";
import { useAttendanceSocket } from "@/hooks/useAttendanceSocket";
import { calculateDuration } from "@/lib/utils";
import { format } from "date-fns";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import SearchDebounce from "@/components/search/searchDebounce";
import { PaginationWithLinks } from "@/components/pagination/pagination";
import { useSession } from "next-auth/react";
import { handleTimeAction } from "../_components/handleTimeAction";
import Link from "next/link";

const EmployeeSiteManagement = ({ searchParams }) => {
  const queryClient = useQueryClient();
  const [showEditForm, setShowEditForm] = useState({});
  const query = searchParams?.query || "";
  const currentPage = parseInt(searchParams?.page) || 1;
  const pageSize = parseInt(searchParams?.pageSize) || 10;

  const { attendanceList, socket, total } = useAttendanceSocket({
    siteId: null,
    employeeId: null,
    currentPage,
    pagePerData: pageSize,
    query,
  });

  const handleManualClockUpdate = async (id, employeeId, actionType) => {
    const result = await handleTimeAction({
      clockId: id,
      type: "office",
      actionType: actionType,
      employeeId,
    });

    if (result?.success) {
      toast.success("Updated successfully");
      // Emit a refresh event to trigger socket update
      if (socket) {
        toast.warning("socket is working");
        // 👇 ADD THIS LINE HERE
        socket.emit("admin-clock-update", employeeId);
      }

      // Immediately reload local attendance data to reflect changes in admin UI
      // Assuming you have access to loadData from your hook, or you can
      // use React Query's invalidateQueries instead
      queryClient.invalidateQueries({ queryKey: ["OfficeEmployeeClock"] });
    } else {
      toast.error("Failed to update clock");
    }
  };
  const handleEdit = (employee) => {
    setShowEditForm(employee);
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setShowEditForm((preForm) => ({
      ...preForm,
      [name]: value,
    }));
  };

  const handleSave = async () => {
    const {
      _id: id,
      clockIn,
      clockOut,
      breakIn,
      breakOut,
      employeeId,
      clockRecordId,
    } = showEditForm;
    const result = await handleTimeAction({
      clockId: clockRecordId || id,
      type: "office",
      manualTimes: {
        clockIn,
        clockOut,
        breakIn,
        breakOut,
      },
    });
    if (result?.success) {
      toast.success("Updated successfully");
      setShowEditForm({});
      socket.emit("admin-clock-update", employeeId);
    } else {
      toast.error("Failed to update clock");
    }
  };

  // State management

  const getStatusBadge = (status) => {
    const statusConfig = {
      "checked-in": {
        color: "bg-green-100 text-green-800",
        text: "Checked In",
      },
      "checked-out": { color: "bg-blue-100 text-blue-800", text: "Completed" },
      "break-in": { color: "bg-yellow-100 text-yellow-800", text: "On Break" },
      "break-out": { color: "bg-purple-100 text-purple-800", text: "On Work" },
    };

    return (
      statusConfig[status] || {
        color: "bg-gray-100 text-gray-800",
        text: "Unknown",
      }
    );
  };

  const handleRemoveAssignment = (assignmentId) => {};

  const { data: session } = useSession();
  const role = session?.user?.role;
  const commonHeaders = [
    "Name",
    "Status",
    "Clock In",
    "Clock Out",
    "Break In",
    "Break Out",
    "Total Hour",
    "Break Hour",
    "Actions",
  ];
  return (
    <div className="max-w-7xl mx-auto space-y-10">
      {/* {JSON.stringify(attendanceList)} */}
      {/* Quick Stats Cards */}
      <Card>
        <CardHeader className="flex justify-between">
          <div>
            <CardTitle>Time Tracking Dashboard</CardTitle>
            <CardDescription>
              View and manage employee attendance and time tracking records
            </CardDescription>
          </div>
          <Button asChild size={"sm"} variant={"outline"}>
            <Link href={"/admin/scan"}>
              <QrCodeIcon />
              Open Scan
            </Link>
          </Button>
        </CardHeader>
        <CardContent className={"grid grid-cols-5 gap-5"}>
          <Card className="bg-indigo-50 text-indigo-600 border-none shadow-none">
            <CardHeader>
              <CardTitle>Total Employees</CardTitle>
              <span className="text-2xl font-semibold">{total || 0}</span>
            </CardHeader>
          </Card>
          <Card className="bg-green-50 text-green-600 border-none shadow-none">
            <CardHeader>
              <CardTitle>Present Today</CardTitle>
              <span className="text-2xl font-semibold">
                {
                  attendanceList.filter((emp) => emp.clockIn && !emp.clockOut)
                    .length
                }
              </span>
            </CardHeader>
          </Card>
          <Card className="bg-yellow-50 text-yellow-600 border-none shadow-none">
            <CardHeader>
              <CardTitle>On Break</CardTitle>
              <span className="text-2xl font-semibold">
                {
                  attendanceList.filter((emp) => emp.breakIn && !emp.breakOut)
                    .length
                }
              </span>
            </CardHeader>
          </Card>
          <Card className="bg-purple-50 text-purple-600 border-none shadow-none">
            <CardHeader>
              <CardTitle>Avarage Hours</CardTitle>
              <span className="text-2xl font-semibold">00:00</span>
            </CardHeader>
          </Card>
          <Card className="bg-red-50 text-red-600 border-none shadow-none">
            <CardHeader>
              <CardTitle>Leaving Today</CardTitle>
              <span className="text-2xl font-semibold">
                {attendanceList.filter((emp) => emp.clockOut).length}
              </span>
            </CardHeader>
          </Card>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <MapPin className="h-5 w-5" />
              Today's Assigned Employees{" "}
              <span className="font-semibold">
                ({attendanceList?.length || 0})
              </span>
            </CardTitle>
            <CardDescription>
              View all employees assigned to sites today •{" "}
              {format(new Date(), "PPP")}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <SearchDebounce />
          </div>
        </CardHeader>
        <CardContent>
          {attendanceList?.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <Users className="h-16 w-16 mx-auto mb-4 opacity-30" />

              <p className="text-lg">No assignments found for this date</p>

              <p className="text-sm">
                Select employees and a site to create assignments
              </p>
            </div>
          ) : (
            <div className=" overflow-x-auto">
              <Table className="w-full">
                <TableHeaderCom tableHead={commonHeaders} />
                <TableBody>
                  {attendanceList?.map((assignment, index) => {
                    const statusConfig = getStatusBadge(assignment?.status);

                    return (
                      <TableRow key={index}>
                        <TableCell>{assignment?.name}</TableCell>
                        <TableCell>
                          <Badge className={statusConfig?.color}>
                            <div className="flex items-center gap-1">
                              {assignment?.status === "checked-in" && (
                                <CheckCircle className="h-3 w-3" />
                              )}

                              {assignment?.status === "clocked-out" && (
                                <CheckCircle className="h-3 w-3" />
                              )}

                              {assignment?.status === "assigned" && (
                                <Clock className="h-3 w-3" />
                              )}

                              {statusConfig?.text || "None"}
                            </div>
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {assignment?.clockRecordId &&
                          assignment?.clockRecordId ===
                            showEditForm.clockRecordId ? (
                            <Input
                              type="time"
                              name="clockIn"
                              value={
                                showEditForm?.clockIn || assignment?.clockIn
                              }
                              className={"max-w-max"}
                              onChange={handleChange}
                            />
                          ) : assignment?.clockIn ? (
                            <div className="flex items-center gap-1 text-green-600 font-medium">
                              <Clock className="h-4 w-4" />

                              {assignment?.clockIn}
                            </div>
                          ) : (
                            "-"
                          )}
                        </TableCell>
                        <TableCell>
                          {assignment?.clockRecordId &&
                          assignment?.clockRecordId ===
                            showEditForm.clockRecordId ? (
                            <Input
                              type="time"
                              name="clockOut"
                              value={
                                showEditForm.clockOut || assignment?.clockOut
                              }
                              className={"max-w-max"}
                              onChange={handleChange}
                            />
                          ) : assignment?.clockOut ? (
                            <div className="flex items-center gap-1 text-blue-600 font-medium">
                              <Clock className="h-4 w-4" />
                              {assignment?.clockOut}
                            </div>
                          ) : (
                            "-"
                          )}
                        </TableCell>
                        <TableCell>
                          {assignment?.clockRecordId &&
                          assignment?.clockRecordId ===
                            showEditForm.clockRecordId ? (
                            <Input
                              type="time"
                              name="breakIn"
                              value={
                                showEditForm.breakIn || assignment?.breakIn
                              }
                              className={"max-w-max"}
                              onChange={handleChange}
                            />
                          ) : assignment?.breakIn ? (
                            <div className="flex items-center gap-1 text-yellow-600 font-medium">
                              <Clock className="h-4 w-4" />
                              {assignment?.breakIn}
                            </div>
                          ) : (
                            "-"
                          )}
                        </TableCell>
                        <TableCell>
                          {assignment?.clockRecordId &&
                          assignment?.clockRecordId ===
                            showEditForm.clockRecordId ? (
                            <Input
                              type="time"
                              name="breakOut"
                              value={
                                showEditForm.breakOut || assignment?.breakOut
                              }
                              className={"max-w-max"}
                              onChange={handleChange}
                            />
                          ) : assignment?.breakOut ? (
                            <div className="flex items-center gap-1 text-purple-600 font-medium">
                              <Clock className="h-4 w-4" />

                              {assignment?.breakOut}
                            </div>
                          ) : (
                            "-"
                          )}
                        </TableCell>
                        <TableCell>
                          {calculateDuration(
                            assignment?.clockIn,
                            assignment?.clockOut
                          ) || "-"}
                        </TableCell>
                        <TableCell>
                          {calculateDuration(
                            assignment?.breakIn,
                            assignment?.breakOut
                          ) || "-"}
                        </TableCell>

                        {(role === "superAdmin" || role === "admin") &&
                          assignment?.clockOut && (
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <AlertDialog>
                                  <AlertDialogTrigger asChild>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      disabled={assignment?.isLocked}
                                      className="text-red-600 hover:text-red-700"
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </Button>
                                  </AlertDialogTrigger>

                                  <AlertDialogContent>
                                    <AlertDialogHeader>
                                      <AlertDialogTitle>
                                        Remove Assignment
                                      </AlertDialogTitle>

                                      <AlertDialogDescription>
                                        Are you sure you want to remove{" "}
                                        {assignment?.firstName} from{" "}
                                        {assignment?.siteName}? This action
                                        cannot be undone.
                                      </AlertDialogDescription>
                                    </AlertDialogHeader>

                                    <AlertDialogFooter>
                                      <AlertDialogCancel>
                                        Cancel
                                      </AlertDialogCancel>

                                      <AlertDialogAction
                                        onClick={() =>
                                          handleRemoveAssignment(assignment._id)
                                        }
                                        className="bg-red-600 hover:bg-red-700"
                                      >
                                        Remove
                                      </AlertDialogAction>
                                    </AlertDialogFooter>
                                  </AlertDialogContent>
                                </AlertDialog>
                              </div>
                            </TableCell>
                          )}
                        {(role === "superAdmin" || role === "admin") &&
                          assignment?.clockOut && (
                            <TableCell>
                              {assignment?._id === showEditForm._id ? (
                                <div className="flex gap-2 items-center">
                                  <Button
                                    onClick={handleSave}
                                    size={"icon"}
                                    variant={"outline"}
                                  >
                                    <SaveIcon />
                                  </Button>
                                  <Button
                                    onClick={() => setShowEditForm({})}
                                    size={"icon"}
                                    variant={"outline"}
                                  >
                                    <XIcon />
                                  </Button>
                                </div>
                              ) : (
                                <Button
                                  onClick={() => handleEdit(assignment)}
                                  size={"icon"}
                                  variant={"outline"}
                                >
                                  <EditIcon />
                                </Button>
                              )}
                            </TableCell>
                          )}
                        <TableCell className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            {!assignment?.clockIn && (
                              <Button
                                onClick={() =>
                                  handleManualClockUpdate(
                                    assignment?.clockRecordId,
                                    assignment?.employeeId,
                                    "clockIn"
                                  )
                                }
                                size="icon"
                                className="bg-green-100 text-green-700 hover:bg-green-200"
                              >
                                <Clock />
                              </Button>
                            )}

                            {assignment?.clockIn &&
                              !assignment?.clockOut &&
                              !assignment?.breakIn && (
                                <Button
                                  onClick={() =>
                                    handleManualClockUpdate(
                                      assignment?.clockRecordId,
                                      assignment?.employeeId,
                                      "breakIn"
                                    )
                                  }
                                  size="icon"
                                  className="bg-yellow-100 text-yellow-700 hover:bg-yellow-200"
                                >
                                  <Coffee />
                                </Button>
                              )}

                            {assignment?.breakIn && !assignment?.breakOut && (
                              <Button
                                onClick={() =>
                                  handleManualClockUpdate(
                                    assignment?.clockRecordId,
                                    assignment?.employeeId,
                                    "breakOut"
                                  )
                                }
                                size="icon"
                                className="bg-blue-100 text-blue-700 hover:bg-blue-200"
                              >
                                <Coffee />
                              </Button>
                            )}

                            {assignment?.clockIn &&
                              !assignment?.clockOut &&
                              (!assignment?.breakIn ||
                                assignment?.breakOut) && (
                                <Button
                                  onClick={() =>
                                    handleManualClockUpdate(
                                      assignment?.clockRecordId,
                                      assignment?.employeeId,
                                      "clockOut"
                                    )
                                  }
                                  size="icon"
                                  className="bg-red-100 text-red-700 hover:bg-red-200"
                                >
                                  <LogOut />
                                </Button>
                              )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
        <CardFooter className={"border-t"}>
          <PaginationWithLinks
            page={1}
            pageSizeSelectOptions={{
              pageSizeOptions: [10, 20, 50, 100],
            }}
            pageSize={pageSize}
            totalCount={total}
          />
        </CardFooter>
      </Card>
    </div>
  );
};

export default EmployeeSiteManagement;
