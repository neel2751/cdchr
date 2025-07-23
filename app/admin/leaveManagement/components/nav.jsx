"use client";
import React from "react";
import SiteNavBar from "../components/header";
import { CommonContext } from "@/context/commonContext";
import { useSession } from "next-auth/react";

export default function Navbar({
  slug,
  searchParams,
  adminMenu,
  slugComponentmap,
  basePath,
  className,
  className2,
  children,
  ...props
}) {
  const { data } = useSession();
  const userRole = data?.user?.role || "employee";
  // we have to check if the role include in the menu then we can filter other whole menu without filtering each time
  const filteredMenu = adminMenu?.filter((item) => {
    if (item?.role) {
      return item.role.includes(userRole);
    }
    return true; // if no role is defined, include the item
  });
  // if the menu is not found then we can return the empty array
  const mainMenu = filteredMenu.length > 0 ? filteredMenu : adminMenu;

  return (
    <CommonContext.Provider value={{ slug, searchParams, ...props }}>
      <SiteNavBar
        slug={slug}
        menu={mainMenu}
        basePath={basePath}
        slugComponentMap={slugComponentmap}
        className={className}
        className2={className2}
      >
        {children}
      </SiteNavBar>
    </CommonContext.Provider>
  );
}
