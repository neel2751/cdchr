import React from "react";
import { Badge } from "../ui/badge";
import { Loader2 } from "lucide-react";

// Define your semantic color themes/palettes in one place
const colorThemes = {
  blue: "bg-blue-100 text-blue-800 hover:bg-blue-200",
  yellow: "bg-yellow-100 text-yellow-800 hover:bg-yellow-200",
  stone: "bg-stone-100 text-stone-800 hover:bg-stone-200",
  orange: "bg-orange-100 text-orange-800 hover:bg-orange-200",
  red: "bg-red-100 text-red-800 hover:bg-red-200",
  green: "bg-green-100 text-green-800 hover:bg-green-200",
  gray: "bg-gray-100 text-gray-800 hover:bg-gray-200",
  darkGray: "bg-gray-200 text-gray-800 hover:bg-gray-300", // A slightly darker gray for "No Status"
  rose: "bg-rose-200 text-rose-800 hover:bg-rose-300",
  amber: "bg-amber-200 text-amber-800 hover:bg-amber-300",
  purple: "bg-purple-200 text-purple-800 hover:bg-purple-300",
  lime: "bg-lime-200 text-lime-800 hover:bg-lime-300",
  teal: "bg-teal-100 text-teal-800 hover:bg-teal-200", // Specific for TableStatus active
};

// Map each specific status to a defined color theme
const statusThemeMap = {
  // Primary workflow statuses
  Completed: "blue",
  "In Progress": "yellow",
  "Not Started": "stone",
  "On Hold": "orange",
  Delayed: "red",
  Cancelled: "red",

  // Review/Approval statuses
  Scheduled: "blue",
  "In Review": "blue",
  Approved: "green",
  Rejected: "red",

  // General state statuses
  Active: "green",
  Inactive: "gray",
  "No Status": "darkGray", // Uses the slightly darker gray

  // Type-specific statuses (e.g., for issues/tasks)
  Bug: "rose",
  Feature: "blue",
  Improvement: "amber",
  Other: "orange",

  // Open/Closed states
  Open: "green",
  Closed: "red",
  Pending: "amber",

  // Newly added statuses
  Expired: "purple",
  Restored: "lime",

  // For Expense Status
  pending: "amber",
  approved: "green",
  rejected: "red",
};

const Status = ({ title }) => {
  // Look up the theme key for the given title
  const themeKey = statusThemeMap[title];
  // Get the actual Tailwind classes from colorThemes,
  // falling back to 'darkGray' if the title isn't mapped
  const statusColor = themeKey ? colorThemes[themeKey] : colorThemes.darkGray;

  return (
    <div className="flex items-center">
      <Badge
        className={`${statusColor} cursor-pointer shadow-none whitespace-nowrap capitalize`}
      >
        {/* Display the title, defaulting to "Unassigned" if empty */}
        {title || "Unassigned"}
      </Badge>
    </div>
  );
};

const TableStatus = ({ isActive, handleClick, isPending }) => {
  // TableStatus directly uses the defined color themes for clarity
  const isActiveClass = isActive
    ? colorThemes.teal // Active state for TableStatus
    : colorThemes.red; // Inactive state for TableStatus

  return (
    <Badge
      className={`cursor-pointer ${isActiveClass} rounded-full`}
      onClick={handleClick}
    >
      {isPending && isPending ? (
        <Loader2 className="animate-spin" />
      ) : isActive ? (
        "Active"
      ) : (
        "Inactive"
      )}
      {/* {isActive ? "Active" : "Inactive"} */}
    </Badge>
  );
};

export { TableStatus, Status };
