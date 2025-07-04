"use client";
import { Sidebar, SidebarRail } from "@/components/ui/sidebar";
import { SideBarFooterCom, SideBarHeaderCom, SideBarMenu } from "./sideBarCom";

export default function SideBar() {
  return (
    <Sidebar collapsible="icon">
      <SideBarHeaderCom />
      <SideBarMenu />
      <SideBarFooterCom />
      <SidebarRail />
    </Sidebar>
  );
}
