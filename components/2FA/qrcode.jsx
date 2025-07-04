"use client";
import { getQRCodeToken } from "@/server/2FAServer/qrcodeServer";
import React, { useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../ui/card";
import { Button } from "../ui/button";
import { RefreshCw } from "lucide-react";

export default function QRCode() {
  const [qr, setQr] = useState("");
  const [expiresIn, setExpiresIn] = useState(50);
  const [expired, setExpired] = useState(false);
  const [loading, setLoading] = useState(false);

  const fetchQr = async () => {
    // add the fake delay
    setLoading(true);
    const response = await getQRCodeToken(expiresIn);
    if (response.success) {
      const data = JSON.parse(response.data);
      setQr(data.qrData);
      setExpiresIn(50);
      setExpired(false);
      setLoading(false);
    }
  };
  // ✅ Fetch QR automatically on first load
  useEffect(() => {
    fetchQr(); // ← this wasn't firing properly before!
  }, []);

  useEffect(() => {
    if (!qr || expired) return;

    const timer = setInterval(() => {
      setExpiresIn((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          setExpired(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [qr, expired]);

  return (
    <Card className="max-w-md mx-auto">
      <CardHeader>
        <CardTitle>Here is your QR code</CardTitle>
        <CardDescription>
          Scan the QR code using your mobile device to verify your identity.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col items-center justify-center pb-4">
          {qr && !expired && (
            <img src={qr} alt="QR Code" className="w-64 h-64 mb-4" />
          )}

          {expired && (
            <CardTitle className="text-red-500 text-sm mb-2">
              QR code expired
            </CardTitle>
          )}

          {!expired ? (
            <p className="text-gray-500 text-sm">Expires in {expiresIn}s</p>
          ) : (
            <Button size="sm" onClick={fetchQr} disabled={loading}>
              <RefreshCw className={`${loading ? "animate-spin" : ""}`} />
              Refresh Code
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

import {
  Clock,
  Coffee,
  LogOut,
  Save,
  X,
  Edit2,
  Search,
  Trash2,
  UserPlus,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export const TimeTrackingDashboard = () => {
  const [currentTime, setCurrentTime] = useState(new Date());
  const [employees, setEmployees] = useState([
    {
      id: "1",
      name: "John Doe",
      clockIn: null,
      clockOut: null,
      breakIn: null,
      breakOut: null,
      breakDuration: "00:00",
      totalHours: "00:00",
      date: new Date().toISOString().split("T")[0],
      department: "Engineering",
    },
    {
      id: "2",
      name: "Jane Smith",
      clockIn: null,
      clockOut: null,
      breakIn: null,
      breakOut: null,
      breakDuration: "00:00",
      totalHours: "00:00",
      date: new Date().toISOString().split("T")[0],
      department: "Design",
    },
  ]);

  const [showEditForm, setShowEditForm] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [showAddEmployee, setShowAddEmployee] = useState(false);
  const [newEmployee, setNewEmployee] = useState({
    name: "",
    department: "",
  });

  const [stats, setStats] = useState({
    totalEmployees: 0,
    presentToday: 0,
    onBreak: 0,
    averageHours: "00:00",
    leavingToday: 0,
  });

  const formatTime = (date) => {
    return date.toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  };

  const calculateDuration = (start, end) => {
    if (!start || !end) return "00:00";

    const [startHours, startMinutes] = start.split(":").map(Number);
    const [endHours, endMinutes] = end.split(":").map(Number);

    let hours = endHours - startHours;
    let minutes = endMinutes - startMinutes;

    if (minutes < 0) {
      hours -= 1;
      minutes += 60;
    }

    if (hours < 0) {
      hours += 24;
    }

    return `${hours.toString().padStart(2, "0")}:${minutes
      .toString()
      .padStart(2, "0")}`;
  };

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const savedData = localStorage.getItem("timeTrackerData");
    if (savedData) {
      setEmployees(JSON.parse(savedData));
    }
  }, []);

  useEffect(() => {
    localStorage.setItem("timeTrackerData", JSON.stringify(employees));
    updateStats();
  }, [employees]);

  const updateStats = () => {
    const today = new Date().toISOString().split("T")[0];
    const todayEmployees = employees.filter((emp) => emp.date === today);

    const present = todayEmployees.filter(
      (emp) => emp.clockIn && !emp.clockOut
    ).length;
    const onBreak = todayEmployees.filter(
      (emp) => emp.breakIn && !emp.breakOut
    ).length;
    const leaving = todayEmployees.filter((emp) => emp.clockIn !== null).length;

    const completedShifts = todayEmployees.filter((emp) => emp.clockOut);
    const totalMinutes = completedShifts.reduce((acc, emp) => {
      const [hours, minutes] = emp.totalHours.split(":").map(Number);
      return acc + (hours * 60 + minutes);
    }, 0);

    const averageMinutes = completedShifts.length
      ? totalMinutes / completedShifts.length
      : 0;
    const averageHours = `${Math.floor(averageMinutes / 60)
      .toString()
      .padStart(2, "0")}:${Math.floor(averageMinutes % 60)
      .toString()
      .padStart(2, "0")}`;

    setStats({
      totalEmployees: employees.length,
      presentToday: present,
      onBreak,
      averageHours,
      leavingToday: leaving,
    });
  };

  const handleTimeAction = (id, action) => {
    const currentTimeStr = formatTime(currentTime);

    setEmployees((prev) =>
      prev.map((emp) => {
        if (emp.id === id) {
          const newEmp = { ...emp };
          newEmp[action] = currentTimeStr;

          if (action === "clockIn") {
            newEmp.date = currentTime.toISOString().split("T")[0];
            newEmp.clockOut = null;
            newEmp.breakIn = null;
            newEmp.breakOut = null;
            newEmp.breakDuration = "00:00";
            newEmp.totalHours = "00:00";
          }

          if (action === "breakOut" && emp.breakIn) {
            newEmp.breakDuration = calculateDuration(
              emp.breakIn,
              currentTimeStr
            );
          }

          if (action === "clockOut" && emp.clockIn) {
            let totalMinutes = 0;
            const workDuration = calculateDuration(emp.clockIn, currentTimeStr);
            const [workHours, workMinutes] = workDuration
              .split(":")
              .map(Number);
            totalMinutes = workHours * 60 + workMinutes;

            if (emp.breakIn && emp.breakOut) {
              const breakDuration = calculateDuration(
                emp.breakIn,
                emp.breakOut
              );
              const [breakHours, breakMinutes] = breakDuration
                .split(":")
                .map(Number);
              totalMinutes -= breakHours * 60 + breakMinutes;
            }

            const finalHours = Math.floor(totalMinutes / 60);
            const finalMinutes = totalMinutes % 60;
            newEmp.totalHours = `${finalHours
              .toString()
              .padStart(2, "0")}:${finalMinutes.toString().padStart(2, "0")}`;
          }

          return newEmp;
        }
        return emp;
      })
    );
  };

  const handleAddEmployee = () => {
    if (!newEmployee.name.trim() || !newEmployee.department.trim()) return;

    const newEntry = {
      id: (employees.length + 1).toString(),
      name: newEmployee.name,
      department: newEmployee.department,
      clockIn: null,
      clockOut: null,
      breakIn: null,
      breakOut: null,
      breakDuration: "00:00",
      totalHours: "00:00",
      date: new Date().toISOString().split("T")[0],
    };

    setEmployees((prev) => [...prev, newEntry]);
    setNewEmployee({ name: "", department: "" });
    setShowAddEmployee(false);
  };

  const handleDeleteEmployee = (id) => {
    setEmployees((prev) => prev.filter((emp) => emp.id !== id));
  };

  const handleEditClick = (employee) => {
    setEditingEmployee({ ...employee });
    setShowEditForm(true);
  };

  const handleEditSave = () => {
    if (!editingEmployee) return;

    const updatedEmployee = { ...editingEmployee };

    if (updatedEmployee.breakIn && updatedEmployee.breakOut) {
      updatedEmployee.breakDuration = calculateDuration(
        updatedEmployee.breakIn,
        updatedEmployee.breakOut
      );
    }

    if (updatedEmployee.clockIn && updatedEmployee.clockOut) {
      let totalMinutes = 0;
      const workDuration = calculateDuration(
        updatedEmployee.clockIn,
        updatedEmployee.clockOut
      );
      const [workHours, workMinutes] = workDuration.split(":").map(Number);
      totalMinutes = workHours * 60 + workMinutes;

      if (updatedEmployee.breakIn && updatedEmployee.breakOut) {
        const breakDuration = calculateDuration(
          updatedEmployee.breakIn,
          updatedEmployee.breakOut
        );
        const [breakHours, breakMinutes] = breakDuration.split(":").map(Number);
        totalMinutes -= breakHours * 60 + breakMinutes;
      }

      const finalHours = Math.floor(totalMinutes / 60);
      const finalMinutes = totalMinutes % 60;
      updatedEmployee.totalHours = `${finalHours
        .toString()
        .padStart(2, "0")}:${finalMinutes.toString().padStart(2, "0")}`;
    }

    setEmployees((prev) =>
      prev.map((emp) => (emp.id === updatedEmployee.id ? updatedEmployee : emp))
    );

    setShowEditForm(false);
    setEditingEmployee(null);
  };

  const filteredEmployees = employees.filter(
    (emp) =>
      emp.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      emp.department.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
          <div className="flex justify-between items-center mb-6">
            <h1 className="text-2xl font-semibold text-gray-800">
              Time Tracking Dashboard
            </h1>
            <div className="text-lg font-medium text-gray-600">
              Current Time: {formatTime(currentTime)}
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            <div className="bg-blue-50 p-4 rounded-lg">
              <h3 className="text-sm font-medium text-blue-600">
                Total Employees
              </h3>
              <p className="text-2xl font-semibold mt-1">
                {stats.totalEmployees}
              </p>
            </div>
            <div className="bg-green-50 p-4 rounded-lg">
              <h3 className="text-sm font-medium text-green-600">
                Present Today
              </h3>
              <p className="text-2xl font-semibold mt-1">
                {stats.presentToday}
              </p>
            </div>
            <div className="bg-yellow-50 p-4 rounded-lg">
              <h3 className="text-sm font-medium text-yellow-600">On Break</h3>
              <p className="text-2xl font-semibold mt-1">{stats.onBreak}</p>
            </div>
            <div className="bg-purple-50 p-4 rounded-lg">
              <h3 className="text-sm font-medium text-purple-600">
                Average Hours
              </h3>
              <p className="text-2xl font-semibold mt-1">
                {stats.averageHours}
              </p>
            </div>
            <div className="bg-red-50 p-4 rounded-lg">
              <h3 className="text-sm font-medium text-red-600">
                Leaving Today
              </h3>
              <p className="text-2xl font-semibold mt-1">
                {stats.leavingToday}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm p-6">
          <div className="flex flex-col sm:flex-row justify-between items-center mb-6 gap-4">
            <div className="flex items-center gap-4">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
                <Input
                  type="text"
                  placeholder="Search employees..."
                  className="pl-9"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
              <Dialog open={showAddEmployee} onOpenChange={setShowAddEmployee}>
                <DialogTrigger asChild>
                  <Button>
                    <UserPlus className="w-4 h-4 mr-2" />
                    Add Employee
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Add New Employee</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4 mt-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Name
                      </label>
                      <Input
                        value={newEmployee.name}
                        onChange={(e) =>
                          setNewEmployee((prev) => ({
                            ...prev,
                            name: e.target.value,
                          }))
                        }
                        placeholder="Employee name"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Department
                      </label>
                      <Input
                        value={newEmployee.department}
                        onChange={(e) =>
                          setNewEmployee((prev) => ({
                            ...prev,
                            department: e.target.value,
                          }))
                        }
                        placeholder="Department"
                      />
                    </div>
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="outline"
                        onClick={() => setShowAddEmployee(false)}
                      >
                        Cancel
                      </Button>
                      <Button onClick={handleAddEmployee}>Add Employee</Button>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-4 text-left text-sm font-medium text-gray-600">
                    Employee
                  </th>
                  <th className="px-6 py-4 text-left text-sm font-medium text-gray-600">
                    Department
                  </th>
                  <th className="px-6 py-4 text-left text-sm font-medium text-gray-600">
                    Clock In
                  </th>
                  <th className="px-6 py-4 text-left text-sm font-medium text-gray-600">
                    Clock Out
                  </th>
                  <th className="px-6 py-4 text-left text-sm font-medium text-gray-600">
                    Break In
                  </th>
                  <th className="px-6 py-4 text-left text-sm font-medium text-gray-600">
                    Break Out
                  </th>
                  <th className="px-6 py-4 text-left text-sm font-medium text-gray-600">
                    Break Duration
                  </th>
                  <th className="px-6 py-4 text-left text-sm font-medium text-gray-600">
                    Total Hours
                  </th>
                  <th className="px-6 py-4 text-left text-sm font-medium text-gray-600">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {filteredEmployees.map((employee) => (
                  <tr key={employee.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center font-medium">
                          {employee.name
                            .split(" ")
                            .map((n) => n[0])
                            .join("")}
                        </div>
                        <span className="font-medium">{employee.name}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-gray-600">
                      {employee.department}
                    </td>
                    <td className="px-6 py-4 text-gray-600">
                      {employee.clockIn || "-"}
                    </td>
                    <td className="px-6 py-4 text-gray-600">
                      {employee.clockOut || "-"}
                    </td>
                    <td className="px-6 py-4 text-gray-600">
                      {employee.breakIn || "-"}
                    </td>
                    <td className="px-6 py-4 text-gray-600">
                      {employee.breakOut || "-"}
                    </td>
                    <td className="px-6 py-4 text-gray-600">
                      {employee.breakDuration}
                    </td>
                    <td className="px-6 py-4 text-gray-600">
                      {employee.totalHours}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        {!employee.clockIn && (
                          <Button
                            onClick={() =>
                              handleTimeAction(employee.id, "clockIn")
                            }
                            size="sm"
                            variant="outline"
                            className="bg-green-100 text-green-700 hover:bg-green-200"
                          >
                            <Clock className="w-4 h-4 mr-1" />
                            In
                          </Button>
                        )}

                        {employee.clockIn &&
                          !employee.clockOut &&
                          !employee.breakIn && (
                            <Button
                              onClick={() =>
                                handleTimeAction(employee.id, "breakIn")
                              }
                              size="sm"
                              variant="outline"
                              className="bg-yellow-100 text-yellow-700 hover:bg-yellow-200"
                            >
                              <Coffee className="w-4 h-4 mr-1" />
                              Break
                            </Button>
                          )}

                        {employee.breakIn && !employee.breakOut && (
                          <Button
                            onClick={() =>
                              handleTimeAction(employee.id, "breakOut")
                            }
                            size="sm"
                            variant="outline"
                            className="bg-blue-100 text-blue-700 hover:bg-blue-200"
                          >
                            <Coffee className="w-4 h-4 mr-1" />
                            Return
                          </Button>
                        )}

                        {employee.clockIn &&
                          !employee.clockOut &&
                          (!employee.breakIn || employee.breakOut) && (
                            <Button
                              onClick={() =>
                                handleTimeAction(employee.id, "clockOut")
                              }
                              size="sm"
                              variant="outline"
                              className="bg-red-100 text-red-700 hover:bg-red-200"
                            >
                              <LogOut className="w-4 h-4 mr-1" />
                              Out
                            </Button>
                          )}

                        <Button
                          onClick={() => handleEditClick(employee)}
                          size="sm"
                          variant="ghost"
                          className="text-blue-600 hover:text-blue-800"
                        >
                          <Edit2 className="w-4 h-4" />
                        </Button>

                        <Button
                          onClick={() => handleDeleteEmployee(employee.id)}
                          size="sm"
                          variant="ghost"
                          className="text-red-600 hover:text-red-800"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Edit Form Modal */}
      {showEditForm && editingEmployee && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-lg shadow-lg w-96">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-semibold">Edit Time Entries</h2>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setShowEditForm(false);
                  setEditingEmployee(null);
                }}
              >
                <X className="w-5 h-5" />
              </Button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Clock In
                </label>
                <Input
                  type="time"
                  value={editingEmployee.clockIn || ""}
                  onChange={(e) =>
                    setEditingEmployee({
                      ...editingEmployee,
                      clockIn: e.target.value,
                    })
                  }
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Clock Out
                </label>
                <Input
                  type="time"
                  value={editingEmployee.clockOut || ""}
                  onChange={(e) =>
                    setEditingEmployee({
                      ...editingEmployee,
                      clockOut: e.target.value,
                    })
                  }
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Break In
                </label>
                <Input
                  type="time"
                  value={editingEmployee.breakIn || ""}
                  onChange={(e) =>
                    setEditingEmployee({
                      ...editingEmployee,
                      breakIn: e.target.value,
                    })
                  }
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Break Out
                </label>
                <Input
                  type="time"
                  value={editingEmployee.breakOut || ""}
                  onChange={(e) =>
                    setEditingEmployee({
                      ...editingEmployee,
                      breakOut: e.target.value,
                    })
                  }
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-6">
              <Button
                variant="outline"
                onClick={() => {
                  setShowEditForm(false);
                  setEditingEmployee(null);
                }}
              >
                Cancel
              </Button>
              <Button onClick={handleEditSave}>
                <Save className="w-4 h-4 mr-2" />
                Save Changes
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
