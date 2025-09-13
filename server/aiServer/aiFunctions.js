export const aiFunctions = [
  {
    name: "getPendingLeaves",
    description: "Get the list of pending leaves for employees",
    parameters: {
      type: "object",
      properties: {
        employeeName: {
          type: "string",
          description: "Name of the employee (optional)",
        },
        date: {
          type: "string",
          description: "Date to check leaves (optional)",
        },
      },
      required: [],
    },
  },
  {
    name: "getVisaExpiring",
    description: "Get employees whose visa is expiring soon",
    parameters: {
      type: "object",
      properties: {
        withinDays: {
          type: "number",
          description: "Check visas expiring within X days",
        },
      },
      required: [],
    },
  },
  {
    name: "getClockInStatus",
    description: "Get employees who clocked in today",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "getNotClockedOut",
    description: "Get employees who did not clock out today",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
];
