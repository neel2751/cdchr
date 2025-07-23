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
  {
    name: "Attendance",
    icon: GlobeLockIcon,
    link: "attendance",
    role: ["superAdmin", "admin", "siteadmin", "employee"],
  },
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
