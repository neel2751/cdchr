import React from "react";
import { SidebarInset, SidebarProvider } from "../ui/sidebar";
import SideBar from "./sidebar";
import Header from "../header/header";

const SidebarWrapper = ({ children }) => {
  return (
    <SidebarProvider>
      <SideBar />
      <SidebarInset>
        <Header />
        {children}
      </SidebarInset>
    </SidebarProvider>
  );
};

export default SidebarWrapper;
