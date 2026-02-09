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
} from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { useFetchQuery, useFetchSelectQuery } from "@/hooks/use-query";
import { getSelectProjects } from "@/server/selectServer/selectServer";
import { useSiteAttendanceSocket } from "@/hooks/useAttendanceSocket";
import {
  calculateDuration,
  calculateTotalPay,
  durationToMinutes,
  minutesToHHMM,
} from "@/lib/utils";
import { format } from "date-fns";
import {
  handleTimeAction,
  handleTimeActionNew,
} from "../_components/handleTimeAction";
import { toast } from "sonner";
import { formatCurrency } from "@/utils/time";
import { useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import SearchDebounce from "@/components/search/searchDebounce";
import { moveEmployeeToNewSite } from "@/server/timeOffServer/updateClockServer";
import { SelectFilter } from "@/components/selectFilter/selectFilter";
import { useCommonContext } from "@/context/commonContext";
import { useSession } from "next-auth/react";
import AddSiteAssignment from "./addSiteAssignment";
import { DateFilter } from "@/components/filters/filterDate/filterDateRange";
import OfficeQRCode from "@/app/hr/code/code";
import { checkPermission } from "@/server/permissionServer/permissionServer";
import { PaginationWithLinks } from "@/components/filters/pagination/pagination-client";

const EmployeeSiteManagement = () => {
  const { filter: searchParams, searchParams: siteId } = useCommonContext();
  const queryClient = useQueryClient();
  const [showEditForm, setShowEditForm] = useState({});
  const query = searchParams?.query;
  const date = searchParams?.assignDate;
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
    fromDate: date,
    toDate: date,
  });

  const { data: sites = [] } = useFetchSelectQuery({
    queryKey: ["selectSiteProject"],
    fetchFn: getSelectProjects,
  });

  // const handleManualClockUpdate = async (
  //   id,
  //   employeeId,
  //   siteId,
  //   actionType
  // ) => {
  //   const result = await handleTimeAction({
  //     clockId: id,
  //     type: "site",
  //     actionType: actionType,
  //     employeeId,
  //     siteId,
  //   });

  //   if (result?.success) {
  //     toast.success("Updated successfully");
  //     // Emit a refresh event to trigger socket update
  //     if (socket) {
  //       toast.warning("socket is working");
  //       // 👇 ADD THIS LINE HERE
  //       socket.emit("admin-clock-update", employeeId);
  //     }

  //     // Immediately reload local attendance data to reflect changes in admin UI
  //     // Assuming you have access to loadData from your hook, or you can
  //     // use React Query's invalidateQueries instead
  //     queryClient.invalidateQueries({ queryKey: queryKey });
  //   } else {
  //     toast.error("Failed to update clock");
  //   }
  // };

  const handleManualClockUpdate = async (
    id,
    employeeId,
    siteId,
    actionType,
    employeeType,
    breaks = []
  ) => {
    // Automatically detect type (no need to pass "site" anymore)
    const result = await handleTimeActionNew({
      clockId: id,
      actionType,
      employeeId,
      siteId: siteId || null, // only included if on a site
      employeeType,
      currentBreaks: breaks, // pass current breaks from UI if needed
    });

    if (result?.success) {
      toast.success("✅ Updated successfully");

      // Emit a socket event to notify live dashboards / site tablets
      if (socket) {
        socket.emit("admin-clock-update", {
          employeeId,
          siteId: siteId || null,
          actionType,
        });
      }

      // ✅ Refresh local data (React Query or custom hook)
      queryClient.invalidateQueries({ queryKey });
    } else {
      toast.error(`❌ Failed to update clock: ${result?.message || ""}`);
    }
  };

  const handleChange = (e) => {
    const { name, value } = e.target;

    // Handle break inputs: breakIn-0, breakOut-1, etc
    if (name.startsWith("break")) {
      const [field, indexStr] = name.split("-");
      const index = Number(indexStr);

      setShowEditForm((prev) => {
        const updatedBreaks = [...(prev.breaks || [])];

        if (!updatedBreaks[index]) {
          updatedBreaks[index] = { breakIn: "", breakOut: "" };
        }

        updatedBreaks[index] = {
          ...updatedBreaks[index],
          [field]: value,
        };

        return {
          ...prev,
          breaks: updatedBreaks,
        };
      });

      return;
    }

    // Normal fields (clockIn, clockOut, etc)
    setShowEditForm((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const addBreak = () => {
    setShowEditForm((prev) => ({
      ...prev,
      breaks: [...(prev.breaks || []), { breakIn: "", breakOut: "" }],
    }));
  };

  const handleSave = async () => {
    const {
      clockIn,
      clockOut,
      breakIn,
      breakOut,
      employeeId,
      siteId,
      clockRecordId,
    } = showEditForm;
    if (!employeeId || !siteId || !clockRecordId) {
      toast.error("Invalid clock record");
      return;
    }
    const result = await handleTimeAction({
      clockId: clockRecordId,
      type: "site",
      siteId,
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
    "Breaks",
    "Total Hour",
    "Break Hour",
  ];
  // Add conditional headers based on role
  const { data } = useFetchQuery({
    fetchFn: checkPermission,
    params: {
      permission: "/admin/siteAssignEmployee",
    },
    queryKey: ["checkPermission", session?.user?.email],
  });

  const hasPermission = data?.newData;

  if (role === "superAdmin" || role === "admin") {
    commonHeaders.push("Pay");
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
          {hasPermission && <AddSiteAssignment queryKey={queryKey} />}
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
              <CardTitle>Clocked Out</CardTitle>
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
            <DateFilter name={"assignDate"} />
            {role === "superAdmin" || role === "admin" ? (
              <SelectFilter
                value={filter.siteId}
                frameworks={[...sites, { label: "All", value: "" }]}
                placeholder={filter.siteId === "" ? "All" : "Select Type"}
                onChange={(e) => setFilter({ ...filter, siteId: e })}
                noData="No Data found"
              />
            ) : (
              <OfficeQRCode
                className={
                  "h-auto text-sm bg-black hover:bg-black/90 cursor-pointer"
                }
              />
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
                        <TableCell>{assignment?.firstName}</TableCell>

                        <TableCell>{assignment?.siteName || "None"}</TableCell>

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
                            addBreak={addBreak}
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

                        {/* PAY */}
                        {(role === "superAdmin" || role === "admin") && (
                          <TableCell>
                            {formatCurrency(
                              calculateTotalPay(
                                calculateDuration(
                                  assignment.clockIn,
                                  assignment.clockOut
                                ),
                                assignment.payRate
                              )
                            ) || "-"}
                          </TableCell>
                        )}

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
                                  <Button
                                    size="icon"
                                    className="bg-green-100 text-green-700"
                                    onClick={() =>
                                      handleManualClockUpdate(
                                        assignment.clockRecordId,
                                        assignment.employeeId,
                                        assignment.siteId,
                                        "clockIn",
                                        assignment.employeeType,
                                        breaks
                                      )
                                    }
                                  >
                                    <Clock />
                                  </Button>
                                )}

                                {/* Break In */}
                                {assignment.clockIn &&
                                  (!lastBreak || lastBreak.breakOut) &&
                                  !assignment.clockOut && (
                                    <Button
                                      size="icon"
                                      className="bg-yellow-100 text-yellow-700"
                                      onClick={() =>
                                        handleManualClockUpdate(
                                          assignment.clockRecordId,
                                          assignment.employeeId,
                                          assignment.siteId,
                                          "breakIn",
                                          assignment.employeeType,
                                          breaks
                                        )
                                      }
                                    >
                                      <Coffee />
                                    </Button>
                                  )}

                                {/* Break Out */}
                                {assignment.clockIn &&
                                  lastBreak &&
                                  !lastBreak.breakOut &&
                                  !assignment.clockOut && (
                                    <Button
                                      size="icon"
                                      className="bg-blue-100 text-blue-700"
                                      onClick={() =>
                                        handleManualClockUpdate(
                                          assignment.clockRecordId,
                                          assignment.employeeId,
                                          assignment.siteId,
                                          "breakOut",
                                          assignment.employeeType,
                                          breaks
                                        )
                                      }
                                    >
                                      <Coffee />
                                    </Button>
                                  )}

                                {/* Clock Out */}
                                {assignment.clockIn &&
                                  !assignment.clockOut &&
                                  (!lastBreak || lastBreak.breakOut) && (
                                    <Button
                                      size="icon"
                                      className="bg-red-100 text-red-700"
                                      onClick={() =>
                                        handleManualClockUpdate(
                                          assignment.clockRecordId,
                                          assignment.employeeId,
                                          assignment.siteId,
                                          "clockOut",
                                          assignment.employeeType,
                                          breaks
                                        )
                                      }
                                    >
                                      <LogOut />
                                    </Button>
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
          {total > pagePerData && <PaginationWithLinks totalCount={total} />}
        </CardContent>
      </Card>
    </div>
  );
};

export default EmployeeSiteManagement;

export const BreaksCell = ({
  clockRecordId,
  showEditForm,
  breaks = [],
  handleChange,
  errors = {},
  addBreak,
  removeBreak,
}) => {
  const isEditing =
    clockRecordId && showEditForm?.clockRecordId === clockRecordId;

  if (isEditing) {
    return (
      <div className="flex gap-2">
        <div className="flex flex-col gap-2">
          {(showEditForm?.breaks || breaks).map((b, i) => (
            <div key={i}>
              <div className="flex gap-2 items-center">
                <Input
                  type="time"
                  name={`breakIn-${i}`}
                  value={b.breakIn || ""}
                  onChange={handleChange}
                  className="max-w-max"
                />
                <Input
                  type="time"
                  name={`breakOut-${i}`}
                  value={b.breakOut || ""}
                  onChange={handleChange}
                  className="max-w-max"
                />
              </div>
              {/* if break have only one entry then don't show remove button */}
              {(i > 0 || (showEditForm?.breaks || breaks).length > 1) && (
                <button
                  type="button"
                  onClick={() => removeBreak(i)}
                  className="text-red-500 font-bold px-2"
                  title="Remove break"
                >
                  ×
                </button>
              )}
              {errors[`break-${i}`] && (
                <span className="text-red-500 text-xs">
                  {errors[`break-${i}`]}
                </span>
              )}
            </div>
          ))}
        </div>

        {/* Add new break */}
        <button
          type="button"
          onClick={addBreak}
          className="text-lg font-bold text-blue-600 cursor-pointer"
          title="Add break"
        >
          +
        </button>
      </div>
    );
  }

  // Display mode
  return breaks.length > 0 ? (
    <div className="flex flex-col gap-1">
      {breaks.map((b, i) => (
        <div
          key={i}
          className="flex gap-1 items-center text-yellow-600 font-medium"
        >
          <Clock className="h-4 w-4" />
          {b.breakIn || "-"} - {b.breakOut || "-"}
        </div>
      ))}
    </div>
  ) : (
    "-"
  );
};
