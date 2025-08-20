"use client";
import { usePathname } from "next/navigation";
import React from "react";
import { SidebarTrigger } from "../ui/sidebar";
import { Separator } from "../ui/separator";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "../ui/breadcrumb";
import OnBoarding from "../onboarding/onBoarding";

const Header = () => {
  const pathName = usePathname();
  // if our path is dynamic , we need to get the menu item that matches the path
  const path = pathName.split("/", 3);
  return (
    <header className="flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12 border-b border-gray-200">
      <div className="flex items-center gap-2 px-4">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="mr-2 h-4" />
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem className="hidden md:block">
              {path[1]?.charAt(0)?.toUpperCase() + path[1]?.slice(1) || "Home"}
            </BreadcrumbItem>
            <BreadcrumbSeparator className="hidden md:block" />
            <BreadcrumbItem>
              <BreadcrumbPage>
                {path[2]?.charAt(0)?.toUpperCase() + path[2]?.slice(1) ||
                  "Dashboard"}
              </BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </div>
      <div className="flex-end ml-auto flex items-center gap-2 pr-4">
        <OnBoarding />
      </div>
    </header>
  );
};

export default Header;
