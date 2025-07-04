export const Employee = [
  {
    id: 1,
    name: "Jhone Doe",
  },
  {
    id: 2,
    name: "Ryan Lee",
  },
  {
    id: 3,
    name: "Arpita",
  },
  {
    id: 4,
    name: "Darvine",
  },
];

export const EmployeeHoliday = [
  {
    id: 1,
    employeeId: 1,
    startDate: "24-04-2025",
    endDate: "26-04-2025",
  },
  {
    id: 2,
    employeeId: 3,
    startDate: "19-04-2025",
    endDate: "23-04-2025",
  },
];

export const EmployeeTimeOff = [
  {
    id: 1,
    employeeId: 1,
    date: "22-04-2025",
    clockIn: "9:40",
    clockOut: "17:00",
    breakTime: [{ startTime: "14:00", endTime: "15:00" }],
  },
];
