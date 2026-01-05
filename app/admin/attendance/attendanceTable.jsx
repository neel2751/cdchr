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
import {
  calculateDuration,
  durationToMinutes,
  minutesToHHMM,
} from "@/lib/utils";
import { format } from "date-fns";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import SearchDebounce from "@/components/search/searchDebounce";
import { PaginationWithLinks } from "@/components/pagination/pagination";
import { useSession } from "next-auth/react";
import { handleTimeActionNew } from "../_components/handleTimeAction";
import Link from "next/link";
import { DateFilter } from "@/components/filters/filterDate/filterDateRange";
import { BreaksCell } from "../siteAssignEmployee/test";

const EmployeeSiteManagement = ({ searchParams }) => {
  const queryClient = useQueryClient();
  const [showEditForm, setShowEditForm] = useState({});
  const [errors, setErrors] = useState({});
  const query = searchParams?.query || "";
  const currentPage = parseInt(searchParams?.page) || 1;
  const pageSize = parseInt(searchParams?.pageSize) || 10;
  const dateParam = searchParams?.date || "";

  const { attendanceList, socket, total } = useAttendanceSocket({
    siteId: null,
    employeeId: null,
    currentPage,
    pagePerData: pageSize,
    fromDate: dateParam,
    toDate: dateParam,
    query,
  });

  const handleManualClockUpdate = async (
    recordId,
    employeeId,
    actionType,
    breaks
  ) => {
    const result = await handleTimeActionNew({
      clockId: recordId,
      employeeId,
      actionType,
      employeeType: "OfficeEmployee",
      currentBreaks: breaks,
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

  const handleChange = (e) => {
    const { name, value } = e.target;

    setShowEditForm((prevForm) => {
      const newForm = { ...prevForm };

      // Update the value
      if (name.startsWith("breakIn-") || name.startsWith("breakOut-")) {
        const [type, index] = name.split("-");
        const idx = Number(index);

        if (!newForm.breaks) newForm.breaks = [];
        if (!newForm.breaks[idx]) newForm.breaks[idx] = {};

        newForm.breaks[idx][type] = value;
      } else {
        newForm[name] = value;
      }

      return newForm;
    });

    // Validation: check breakIn < breakOut
    setErrors((prevErrors) => {
      const newErrors = { ...prevErrors };
      if (name.startsWith("breakIn-") || name.startsWith("breakOut-")) {
        const [type, index] = name.split("-");
        const idx = Number(index);

        const breakIn = showEditForm.breaks?.[idx]?.breakIn || "";
        const breakOut = showEditForm.breaks?.[idx]?.breakOut || "";

        if (breakIn && breakOut) {
          const [h1, m1] = breakIn.split(":").map(Number);
          const [h2, m2] = breakOut.split(":").map(Number);

          if (h2 * 60 + m2 < h1 * 60 + m1) {
            newErrors[`break-${idx}`] =
              "Break Out cannot be earlier than Break In";
          } else {
            delete newErrors[`break-${idx}`];
          }
        } else {
          delete newErrors[`break-${idx}`];
        }
      }
      return newErrors;
    });
  };

  const handleSave = async () => {
    const {
      _id: id,
      clockIn,
      clockOut,
      breaks,
      employeeId,
      clockRecordId,
    } = showEditForm;

    const result = await handleTimeActionNew({
      clockId: clockRecordId || id,
      employeeId,
      manualTimes: {
        clockIn,
        clockOut,
        breaks,
      },
      employeeType: "OfficeEmployee",
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
          <div className="flex items-center gap-2">
            <Button asChild size={"sm"} variant={"outline"}>
              <Link href={"/admin/scan"}>
                <QrCodeIcon />
                Open Scan
              </Link>
            </Button>
            <DateFilter name={"date"} />
          </div>
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
                    // compute status
                    const status = !assignment.clockIn
                      ? "assigned"
                      : assignment.clockIn && !assignment.clockOut
                      ? "checked-in"
                      : "clocked-out";

                    const statusConfig = getStatusBadge(status);

                    // compute last break
                    const breaks = assignment?.breaks || [];
                    const lastBreak = breaks.length
                      ? breaks[breaks.length - 1]
                      : null;

                    // calculate total break hours
                    const breakMinutes = breaks.reduce((sum, br) => {
                      if (br.breakIn && br.breakOut) {
                        return sum + durationToMinutes(br.breakIn, br.breakOut);
                      }
                      return sum;
                    }, 0);

                    const breakHours = minutesToHHMM(breakMinutes);

                    return (
                      <TableRow key={index}>
                        <TableCell>{assignment?.name}</TableCell>
                        <TableCell>
                          {assignment?.employeeType === "Employee"
                            ? "Employee"
                            : "Office Employee"}
                        </TableCell>

                        {/* STATUS */}
                        <TableCell>
                          <Badge className={statusConfig?.color}>
                            <div className="flex items-center gap-1">
                              {status === "checked-in" && (
                                <CheckCircle className="h-3 w-3" />
                              )}
                              {status === "clocked-out" && (
                                <CheckCircle className="h-3 w-3" />
                              )}
                              {status === "assigned" && (
                                <Clock className="h-3 w-3" />
                              )}
                              {statusConfig?.text}
                            </div>
                          </Badge>
                        </TableCell>

                        {/* CLOCK IN */}
                        <TableCell>
                          {assignment.clockRecordId ===
                          showEditForm.clockRecordId ? (
                            <Input
                              type="time"
                              name="clockIn"
                              value={showEditForm.clockIn || assignment.clockIn}
                              onChange={handleChange}
                            />
                          ) : assignment.clockIn ? (
                            <div className="flex items-center gap-1 text-green-600 font-medium">
                              <Clock className="h-4 w-4" />
                              {assignment.clockIn}
                            </div>
                          ) : (
                            "-"
                          )}
                        </TableCell>

                        {/* CLOCK OUT */}
                        <TableCell>
                          {assignment.clockRecordId ===
                          showEditForm.clockRecordId ? (
                            <Input
                              type="time"
                              name="clockOut"
                              value={
                                showEditForm.clockOut || assignment.clockOut
                              }
                              onChange={handleChange}
                            />
                          ) : assignment.clockOut ? (
                            <div className="flex items-center gap-1 text-blue-600 font-medium">
                              <Clock className="h-4 w-4" />
                              {assignment.clockOut}
                            </div>
                          ) : (
                            "-"
                          )}
                        </TableCell>

                        {/* BREAKS */}
                        <TableCell>
                          <BreaksCell
                            clockRecordId={assignment.clockRecordId}
                            showEditForm={showEditForm}
                            breaks={assignment.breaks}
                            handleChange={handleChange}
                            errors={errors}
                          />
                        </TableCell>

                        {/* TOTAL HOURS */}
                        <TableCell>
                          {calculateDuration(
                            assignment.clockIn,
                            assignment.clockOut
                          ) || "-"}
                        </TableCell>
                        {/* BREAK HOURS */}
                        <TableCell>{breakHours || "-"}</TableCell>

                        {/* ACTION BUTTONS (CLOCK IN/OUT/BREAK IN/OUT/EDIT/DELETE) */}
                        <TableCell>
                          <div className="flex items-center gap-2">
                            {/* Only show SAVE + CANCEL if row is being edited and has a clock record */}
                            {assignment.clockRecordId &&
                            showEditForm?._id === assignment._id ? (
                              <>
                                <Button
                                  size="icon"
                                  variant="outline"
                                  onClick={handleSave} // save handler
                                  disabled={Object.keys(errors).length > 0}
                                >
                                  <SaveIcon />
                                </Button>
                                <Button
                                  size="icon"
                                  variant="outline"
                                  onClick={() => setShowEditForm({})} // cancel edit
                                >
                                  <XIcon />
                                </Button>
                              </>
                            ) : (
                              <>
                                {/* Clock In */}
                                {!assignment.clockIn && (
                                  <ClockConfirmDialog
                                    action="clockIn"
                                    employeeName={assignment.name}
                                    onConfirm={() =>
                                      handleManualClockUpdate(
                                        assignment.clockRecordId,
                                        assignment.employeeId,
                                        "clockIn",
                                        breaks
                                      )
                                    }
                                  >
                                    <Button
                                      size="icon"
                                      className="bg-green-100 text-green-700"
                                    >
                                      <CheckCircle />
                                    </Button>
                                  </ClockConfirmDialog>
                                )}

                                {/* Break In */}
                                {assignment.clockIn &&
                                  (!lastBreak || lastBreak.breakOut) &&
                                  !assignment.clockOut && (
                                    <ClockConfirmDialog
                                      action="breakIn"
                                      employeeName={assignment.name}
                                      onConfirm={() =>
                                        handleManualClockUpdate(
                                          assignment.clockRecordId,
                                          assignment.employeeId,
                                          "breakIn",
                                          breaks
                                        )
                                      }
                                    >
                                      <Button
                                        size="icon"
                                        className="bg-yellow-100 text-yellow-700"
                                      >
                                        <Coffee />
                                      </Button>
                                    </ClockConfirmDialog>
                                  )}

                                {/* Break Out */}
                                {assignment.clockIn &&
                                  lastBreak &&
                                  !lastBreak.breakOut &&
                                  !assignment.clockOut && (
                                    <ClockConfirmDialog
                                      action="breakOut"
                                      employeeName={assignment.name}
                                      onConfirm={() =>
                                        handleManualClockUpdate(
                                          assignment.clockRecordId,
                                          assignment.employeeId,
                                          "breakOut",
                                          breaks
                                        )
                                      }
                                    >
                                      <Button
                                        size="icon"
                                        className="bg-blue-100 text-blue-700"
                                      >
                                        <Coffee />
                                      </Button>
                                    </ClockConfirmDialog>
                                  )}

                                {/* Clock Out */}
                                {assignment.clockIn &&
                                  !assignment.clockOut &&
                                  (!lastBreak || lastBreak.breakOut) && (
                                    <ClockConfirmDialog
                                      action="clockOut"
                                      employeeName={assignment.name}
                                      onConfirm={() =>
                                        handleManualClockUpdate(
                                          assignment.clockRecordId,
                                          assignment.employeeId,
                                          "clockOut",
                                          breaks
                                        )
                                      }
                                    >
                                      <Button
                                        size="icon"
                                        className="bg-red-100 text-red-700"
                                      >
                                        <LogOut />
                                      </Button>
                                    </ClockConfirmDialog>
                                  )}

                                {/* EDIT / DELETE only after Clock Out */}
                                {assignment.clockOut && (
                                  <>
                                    <Button
                                      size="icon"
                                      variant="outline"
                                      onClick={() =>
                                        setShowEditForm(assignment)
                                      }
                                    >
                                      <EditIcon />
                                    </Button>
                                    <Button
                                      size="icon"
                                      variant="outline"
                                      onClick={() =>
                                        handleRemoveAssignment(assignment._id)
                                      }
                                    >
                                      <Trash2 />
                                    </Button>
                                  </>
                                )}
                              </>
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
          {/* {total > pagePerData && <Pagination />} */}
          {/* {total > pagePerData && <PaginationWithLinks totalCount={total} />} */}
        </CardContent>
        <CardFooter className={"border-t"}>
          {total > 10 && (
            <PaginationWithLinks
              page={currentPage}
              pageSizeSelectOptions={{
                pageSizeOptions: [10, 20, 50, 100],
              }}
              pageSize={pageSize}
              totalCount={total}
            />
          )}
        </CardFooter>
      </Card>
    </div>
  );
};

export default EmployeeSiteManagement;

// alert dialog for clock confirmation copomponent

export const ClockConfirmDialog = ({
  action,
  employeeName,
  onConfirm,
  children,
}) => {
  const actionConfig = {
    clockIn: {
      title: "Are you sure you want to clock in?",
      description: `This will record the clock in time for the ${employeeName} employee.`,
      confirmText: "Clock In",
      confirmClass: "bg-green-600 hover:bg-green-700",
    },
    clockOut: {
      title: "Are you sure you want to clock out?",
      description: `This will record the clock out time for the ${employeeName} employee.`,
      confirmText: "Clock Out",
      confirmClass: "bg-red-600 hover:bg-red-700",
    },
    breakIn: {
      title: "Are you sure you want to start a break?",
      description: `This will record the break start time for the ${employeeName} employee.`,
      confirmText: "Start Break",
      confirmClass: "bg-yellow-600 hover:bg-yellow-700",
    },
    breakOut: {
      title: "Are you sure you want to end the break?",
      description: `This will record the break end time for the ${employeeName} employee.`,
      confirmText: "End Break",
      confirmClass: "bg-blue-600 hover:bg-blue-700",
    },
  };

  const config = actionConfig[action] || {};

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>{children}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{config.title}</AlertDialogTitle>
          <AlertDialogDescription>{config.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className={config.confirmClass}
            onClick={onConfirm}
          >
            {config.confirmText}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
