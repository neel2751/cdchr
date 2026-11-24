import React from "react";
import { SidebarInset, SidebarProvider } from "../ui/sidebar";
import SideBar from "./sidebar";
import Header from "../header/header";

/**
 * `banners` sit at the top of the content area, beside the sidebar. Above the
 * whole shell they ran underneath the sidebar, which is fixed to the left
 * edge — the coloured strip showed and the words behind it did not.
 */
const SidebarWrapper = ({ children, banners = null }) => {
  return (
    <SidebarProvider>
      <SideBar />
      <SidebarInset>
        {banners}
        <Header />
        {children}
      </SidebarInset>
    </SidebarProvider>
  );
};

export default SidebarWrapper;
