export const mockEmployees = [
  {
    id: "1",
    name: "John Doe",
    department: "Engineering",
    avatar: "/placeholder.svg?height=32&width=32",
  },
  {
    id: "2",
    name: "Jane Smith",
    department: "HR",
    avatar: "/placeholder.svg?height=32&width=32",
  },
  {
    id: "3",
    name: "Mike Johnson",
    department: "Marketing",
    avatar: "/placeholder.svg?height=32&width=32",
  },
  {
    id: "4",
    name: "Emily Brown",
    department: "Engineering",
    avatar: "/placeholder.svg?height=32&width=32",
  },
  {
    id: "5",
    name: "Chris Lee",
    department: "Sales",
    avatar: "/placeholder.svg?height=32&width=32",
  },
];

export const mockLeaveRequests = [
  {
    id: "1",
    employeeId: "1",
    leaveType: "Annual",
    startDate: "2023-07-01",
    endDate: "2023-07-05",
    status: "Pending",
  },
  {
    id: "2",
    employeeId: "2",
    leaveType: "Sick",
    startDate: "2023-06-28",
    endDate: "2023-06-30",
    status: "Approved",
  },
  {
    id: "3",
    employeeId: "3",
    leaveType: "Maternity",
    startDate: "2023-08-01",
    endDate: "2023-11-01",
    status: "Approved",
  },
  {
    id: "4",
    employeeId: "4",
    leaveType: "Annual",
    startDate: "2023-07-15",
    endDate: "2023-07-20",
    status: "Approved",
  },
  {
    id: "5",
    employeeId: "5",
    leaveType: "Paternity",
    startDate: "2023-09-01",
    endDate: "2023-09-14",
    status: "Pending",
  },
];

export const mockLeaveEntitlements = [
  { employeeId: "1", type: "Annual", total: 25, used: 10, remaining: 15 },
  { employeeId: "1", type: "Sick", total: 10, used: 2, remaining: 8 },
  { employeeId: "2", type: "Annual", total: 28, used: 5, remaining: 23 },
  { employeeId: "2", type: "Sick", total: 10, used: 3, remaining: 7 },
  { employeeId: "3", type: "Annual", total: 25, used: 15, remaining: 10 },
  { employeeId: "3", type: "Maternity", total: 52, used: 0, remaining: 52 },
  { employeeId: "4", type: "Annual", total: 25, used: 8, remaining: 17 },
  { employeeId: "4", type: "Sick", total: 10, used: 1, remaining: 9 },
  { employeeId: "5", type: "Annual", total: 25, used: 12, remaining: 13 },
  { employeeId: "5", type: "Paternity", total: 2, used: 0, remaining: 2 },
];
