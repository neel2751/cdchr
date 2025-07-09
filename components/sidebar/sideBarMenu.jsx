import {
  Briefcase,
  Building2,
  CalendarClock,
  CalendarDays,
  Captions,
  ClipboardIcon,
  Filter,
  LayoutDashboard,
  Network,
  NewspaperIcon,
  RadioIcon,
  Stamp,
  LockIcon,
} from "lucide-react";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "../ui/sidebar";
import { Collapsible } from "../ui/collapsible";
import Link from "next/link";
import React from "react";

const ICON_MAP = {
  Briefcase: Briefcase,
  Building2: Building2,
  CalendarDays: CalendarDays,
  Captions: Captions,
  ClipboardIcon: ClipboardIcon,
  Filter: Filter,
  LayoutDashboard: LayoutDashboard,
  Network: Network,
  NewspaperIcon: NewspaperIcon,
  RadioIcon: RadioIcon,
  Stamp: Stamp,
  CalendarClock: CalendarClock,
  Lock: LockIcon,
};

export default function SideBarMenuCom({ menuItems, path }) {
  return (
    <SidebarMenu className="gap-4">
      {menuItems?.map((item, index) => (
        <Collapsible
          key={index}
          asChild
          //   defaultOpen={item?.name === currentMenu?.name}
          className="group/collapsible"
        >
          <SidebarMenuItem>
            {/* <CollapsibleTrigger asChild> */}
            <SidebarMenuButton
              asChild
              tooltip={item?.name}
              className={`${
                item?.path === path
                  ? "bg-neutral-200 text-neutral-900"
                  : "hover:bg-gray-100"
              } text-sm text-gray-800 font-normal rounded-lg flex items-center p-2 group`}
            >
              <Link href={item?.path} className="flex gap-2 items-center">
                {ICON_MAP[item.icon] &&
                  React.createElement(ICON_MAP[item.icon], {
                    className: "w-5 h-5 mr-2",
                  })}
                <span>{item?.name}</span>
              </Link>
            </SidebarMenuButton>
            {/* </CollapsibleTrigger> */}
          </SidebarMenuItem>
        </Collapsible>
      ))}
    </SidebarMenu>
  );
}
