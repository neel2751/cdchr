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
  QrCode,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import TableHeaderCom from "@/components/tableStatus/tableHeader";
import { useFetchSelectQuery } from "@/hooks/use-query";
import { getSelectProjects } from "@/server/selectServer/selectServer";
import { useSiteAttendanceSocket } from "@/hooks/useAttendanceSocket";
import { calculateDuration, calculateTotalPay } from "@/lib/utils";
import { format } from "date-fns";
import { handleTimeAction } from "../_components/handleTimeAction";
import { toast } from "sonner";
import { formatCurrency } from "@/utils/time";
import { useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import SearchDebounce from "@/components/search/searchDebounce";
import { PaginationWithLinks } from "@/components/pagination/pagination";
import { moveEmployeeToNewSite } from "@/server/timeOffServer/updateClockServer";
import { SelectFilter } from "@/components/selectFilter/selectFilter";
import { useCommonContext } from "@/context/commonContext";
import { useSession } from "next-auth/react";
import { decrypt } from "@/lib/algo";
import Link from "next/link";
import AddSiteAssignment from "./addSiteAssignment";
import Pagination from "@/lib/pagination";

const EmployeeSiteManagement = () => {
  const { filter: searchParams, searchParams: siteId } = useCommonContext();
  const queryClient = useQueryClient();
  const [showEditForm, setShowEditForm] = useState({});
  const query = searchParams?.query;
  const currentPage = parseInt(searchParams?.page || "1");
  const pagePerData = parseInt(searchParams?.pageSize || "10");

  const [filter, setFilter] = useState({
    siteId: (siteId && siteId[0]) || null,
  });

  const { attendanceList, socket, total, queryKey } = useSiteAttendanceSocket({
    ...filter,
    currentPage,
    pagePerData,
    query,
  });

  const { data: sites = [] } = useFetchSelectQuery({
    queryKey: ["selectSiteProject"],
    fetchFn: getSelectProjects,
  });

  const handleManualClockUpdate = async (
    id,
    employeeId,
    siteId,
    actionType
  ) => {
    const result = await handleTimeAction({
      clockId: id,
      type: "site",
      actionType: actionType,
      employeeId,
      siteId,
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
      queryClient.invalidateQueries({ queryKey: queryKey });
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
      employee,
    } = showEditForm;
    const employeeId = employee.employeeId;
    const result = await handleTimeAction({
      clockId: id,
      type: "site",
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

  const handleMoveEmployee = async (employeeId, toSiteId, date) => {
    const res = await moveEmployeeToNewSite({ employeeId, toSiteId, date });
    if (res.success) {
      toast.success(res.message);
    } else {
      toast.error(res.message || "Something went wrong");
    }
  };

  const { data: session } = useSession();
  const role = session?.user?.role;
  const commonHeaders = [
    "Name",
    "SiteName",
    "Status",
    "Clock In",
    "Clock Out",
    "Break In",
    "Break Out",
    "Total Hour",
    "Break Hour",
  ];
  if (role === "superAdmin" || role === "admin") {
    commonHeaders.push("Pay", "Move");
    commonHeaders.push("Actions");
  } else {
    commonHeaders.push("Actions");
  }

  return (
    <div className="max-w-7xl mx-auto space-y-10">
      {/* {JSON.stringify(attendanceList)} */}
      {/* Quick Stats Cards */}
      <Card>
        <CardHeader className={"flex items-center justify-between"}>
          <div>
            <CardTitle>Time Tracking Dashboard</CardTitle>
            <CardDescription>Current Time</CardDescription>
          </div>
          {role === "superAdmin" ||
            (role === "admin" && <AddSiteAssignment queryKey={queryKey} />)}
        </CardHeader>
        <CardContent className={"grid grid-cols-5 gap-5"}>
          <Card className="bg-indigo-50 text-indigo-600 border-none shadow-none">
            <CardHeader>
              <CardTitle>Total Employees</CardTitle>
              <span className="text-2xl font-semibold">
                {attendanceList?.length}
              </span>
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
            {role === "superAdmin" || role === "admin" ? (
              <SelectFilter
                value={filter.siteId}
                frameworks={[...sites, { label: "All", value: "" }]}
                placeholder={filter.siteId === "" ? "All" : "Select Type"}
                onChange={(e) => setFilter({ ...filter, siteId: e })}
                noData="No Data found"
              />
            ) : (
              // show only siteName
              <Button asChild>
                <Link
                  href={`scan?siteName=${
                    sites.find((s) => s.value === decrypt(filter?.siteId))
                      ?.label
                  }`}
                >
                  <QrCode />
                  Scan QR
                </Link>
              </Button>
            )}
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
                        <TableCell>{assignment?.firstName}</TableCell>
                        <TableCell>{assignment?.siteName || "None"}</TableCell>
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
                        {(role === "superAdmin" || role === "admin") && (
                          <TableCell>
                            {formatCurrency(
                              calculateTotalPay(
                                calculateDuration(
                                  calculateDuration(
                                    assignment?.breakIn,
                                    assignment?.breakOut
                                  ),
                                  calculateDuration(
                                    assignment?.clockIn,
                                    assignment?.clockOut
                                  )
                                ),
                                assignment?.payRate
                              )
                            ) || "-"}
                          </TableCell>
                        )}
                        {(role === "superAdmin" || role === "admin") && (
                          <TableCell>
                            <Select
                              disabled={assignment?.isLocked}
                              onValueChange={(newSiteId) =>
                                handleMoveEmployee(
                                  assignment?.employeeId,
                                  newSiteId,
                                  assignment?.assignDate
                                )
                              }
                            >
                              <SelectTrigger className="w-24">
                                <SelectValue placeholder="Move" />
                              </SelectTrigger>

                              <SelectContent>
                                {sites
                                  .filter(
                                    (s) => s?.value !== assignment?.siteId
                                  )
                                  .map((site) => (
                                    <SelectItem
                                      key={site?.value}
                                      value={site?.value}
                                    >
                                      {site?.label}
                                    </SelectItem>
                                  ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                        )}
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
                                    assignment?.siteId,
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
                                      assignment?.siteId,
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
                                    assignment?.siteId,
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
                                      assignment?.siteId,
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
          {total > pagePerData && <Pagination />}
        </CardContent>
      </Card>
    </div>
  );
};

export default EmployeeSiteManagement;
