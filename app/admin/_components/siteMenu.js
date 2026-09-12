"use client";
import {
  EditIcon,
  FileLockIcon,
  GlobeLockIcon,
  HomeIcon,
  LockIcon,
} from "lucide-react";

export const siteEmployeeMenu = [
  {
    name: "Overview",
    icon: HomeIcon,
    link: "overview",
    role: ["superAdmin", "admin", "siteadmin", "employee"],
  },
  // Hidden for now. The tab is only taken out of the nav — the route and its
  // component (siteEmployeeSlugMap.attendance) are untouched.
  // {
  //   name: "Attendance",
  //   icon: GlobeLockIcon,
  //   link: "attendance",
  //   role: ["superAdmin", "admin", "siteadmin", "employee"],
  // },
  // {
  //   name: "Edit",
  //   icon: EditIcon,
  //   link: "edit",
  //   role: ["superAdmin", "admin", "siteadmin", "employee"],
  // },
  {
    name: "Document",
    link: "document",
    icon: FileLockIcon,
    role: ["superAdmin", "admin"],
  },
  {
    name: "Password",
    link: "password",
    icon: LockIcon,
    role: ["superAdmin", "admin", "siteadmin", "employee"],
  },
  // {
  //   name: "Session",
  //   link: "session",
  //   icon: GlobeLockIcon,
  //   role: ["superAdmin", "admin", "employee"],
  // },
];
