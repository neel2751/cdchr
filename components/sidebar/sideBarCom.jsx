"use client";
import {
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "../ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "../ui/avatar";
import {
  BadgeCheck,
  Bell,
  ChevronsUpDown,
  CreditCard,
  LogOut,
  Sparkles,
} from "lucide-react";
import { signOut, useSession } from "next-auth/react";
import Image from "next/image";
import { COMMONMENUITEMS, getMenu, getReportMenu, REPORT } from "@/data/menu";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Collapsible } from "../ui/collapsible";
import { useFetchSelectQuery } from "@/hooks/use-query";
import { getEmployeeMenu } from "@/server/selectServer/selectServer";
import SideBarMenuCom from "./sideBarMenu";
import { mergeAndFilterMenus } from "@/lib/object";
import { encrypt } from "@/lib/algo";
import { useMemo } from "react";

const SideBarHeaderCom = () => {
  return (
    <SidebarHeader>
      <SidebarMenu>
        <SidebarMenuItem>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <SidebarMenuButton
                size="lg"
                className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
              >
                <div className="flex aspect-square size-8 items-center border border-neutral-200 justify-center rounded-lg text-sidebar-primary-foreground">
                  <Image
                    // src="/images/cdc.svg"
                    src={
                      // "https://res.cloudinary.com/drcjzx0sw/image/upload/v1746444818/hr_jlxx1c.svg"
                      "/images/Interiorlogo.svg"
                    }
                    alt="Logo"
                    width={30}
                    height={30}
                    className="rounded-lg"
                  />
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  {/* <span className="truncate font-semibold">CDC</span> */}
                  <span className="truncate font-semibold">Hr Management</span>
                  <span className="truncate text-xs">
                    {/* Creative Design & Construction */}
                  </span>
                </div>
              </SidebarMenuButton>
            </DropdownMenuTrigger>
          </DropdownMenu>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarHeader>
  );
};

const SideBarMenu = () => {
  const pathName = usePathname();
  const { data: sessionData } = useSession();
  const currentRole = sessionData?.user?.role;
  const currentUserId = sessionData?.user?._id;

  // Memoize the path to avoid recalculation
  const rootPath = useMemo(() => pathName.split("/", 3).join("/"), [pathName]);

  // Fetch employee menu (React Query / SWR style)
  const { data: menuItems = [], isLoading } = useFetchSelectQuery({
    fetchFn: getEmployeeMenu,
    queryKey: ["employeeMenu", sessionData?.user?._id],
  });

  // Merge menus and memoize to prevent recalculation on re-render
  const menu = useMemo(
    () => mergeAndFilterMenus(COMMONMENUITEMS, menuItems),
    [menuItems],
  );

  const personalMenu = useMemo(() => {
    if (currentRole !== "user" || !currentUserId) return [];

    return [
      {
        name: "My Attendance",
        path: "/admin/my-attendance",
        icon: "CalendarClock",
      },
      {
        name: "My Weekly Shifts",
        path: "/admin/my-weekly-shifts",
        icon: "CalendarDays",
      },
      {
        name: "My Leaves",
        path: "/admin/my-leaves",
        icon: "Stamp",
      },
    ];
  }, [currentRole, currentUserId]);

  const mergedMenu = useMemo(() => {
    if (!personalMenu.length) return menu;

    const existingPaths = new Set(menu.map((item) => item?.path));
    const uniquePersonalMenu = personalMenu.filter(
      (item) => !existingPaths.has(item.path),
    );

    return [...uniquePersonalMenu, ...menu];
  }, [personalMenu, menu]);

  // Determine current menus and reports
  const currentMenu = useMemo(() => getMenu(rootPath), [rootPath]);
  const currentReport = useMemo(() => getReportMenu(rootPath), [rootPath]);

  return (
    <SidebarContent>
      {isLoading ? (
        // Skeleton loader while menu is fetching
        <SidebarGroup>
          {[...Array(5)].map((_, i) => (
            <div
              key={i}
              className="h-6 bg-gray-200 rounded mb-2 animate-pulse"
            />
          ))}
        </SidebarGroup>
      ) : (
        <SidebarGroup>
          <SideBarMenuCom menuItems={mergedMenu} path={pathName} />
        </SidebarGroup>
      )}

      {(sessionData?.user?.role === "superAdmin" ||
        sessionData?.user?.role === "admin") && (
        <SidebarGroup>
          <SidebarGroupLabel>More</SidebarGroupLabel>
          <SidebarMenu className="gap-4">
            {REPORT?.map((item) => (
              <Collapsible
                key={item?.name}
                asChild
                defaultOpen={item?.name === currentMenu?.name}
                className="group/collapsible"
              >
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    tooltip={item?.name}
                    className={`${
                      item?.name === currentReport?.name
                        ? "bg-neutral-200 text-neutral-900"
                        : "hover:bg-gray-100"
                    } text-sm text-gray-800 font-normal rounded-lg flex items-center p-2 group`}
                  >
                    <Link href={item?.path} className="flex gap-2 items-center">
                      {item?.icon}
                      <span>{item?.name}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </Collapsible>
            ))}
          </SidebarMenu>
        </SidebarGroup>
      )}
    </SidebarContent>
  );
};
const SideBarFooterCom = () => {
  const { data: session } = useSession();

  return (
    <SidebarFooter className="border-t">
      <SidebarMenu>
        <SidebarMenuItem>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <SidebarMenuButton
                size="lg"
                className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
              >
                <Avatar className="h-8 w-8 rounded-lg border p-1 bg-black">
                  <AvatarImage
                    // src={session?.user?.image || "/images/cdc.svg"}
                    src={
                      // "https://res.cloudinary.com/drcjzx0sw/image/upload/v1746444818/hr_jlxx1c.svg"
                      "/images/Interiorlogo.svg"
                    }
                    alt={session?.user?.name || "HR"}
                  />
                  <AvatarFallback className="rounded-lg">N</AvatarFallback>
                </Avatar>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">
                    {session?.user?.name || "Hr Management"}
                  </span>
                  <span className="truncate text-xs">
                    {session?.user?.role || "hr"}
                  </span>
                </div>
                <ChevronsUpDown className="ml-auto size-4" />
              </SidebarMenuButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
              side="bottom"
              align="end"
              sideOffset={4}
            >
              <DropdownMenuLabel className="p-0 font-normal">
                <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                  <Avatar className="h-8 w-8 rounded-lg p-1 border">
                    <AvatarImage
                      // src={session?.user?.image || "/images/cdc.svg"}
                      src={
                        // "https://res.cloudinary.com/drcjzx0sw/image/upload/v1746444818/hr_jlxx1c.svg"
                        "/images/Interiorlogo.svg"
                      }
                      alt={session?.user?.name || "HR"}
                    />
                    <AvatarFallback className="rounded-lg">N</AvatarFallback>
                  </Avatar>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-semibold">
                      {session?.user?.name || "HR"} -{" "}
                      <span className="text-xs lowercase text-neutral-700">
                        {session?.user?.role || "None"}
                      </span>
                    </span>
                    <span className="truncate text-xs">
                      {session?.user?.email || ""}
                    </span>
                  </div>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem>
                  <Sparkles className="text-neutral-500" />
                  <span className="text-xs font-medium text-neutral-500">
                    Current Version : HR/V12.7
                  </span>
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem className="w-full">
                  <Link
                    className="flex items-center gap-2 w-full"
                    href={`/admin/account/${encrypt(
                      session?.user?._id,
                    )}/overview`}
                  >
                    <BadgeCheck />
                    Account
                  </Link>
                </DropdownMenuItem>
                {/* <DropdownMenuItem>
                  <CreditCard />
                  Billing
                </DropdownMenuItem>
                <DropdownMenuItem>
                  <Bell />
                  Notifications
                </DropdownMenuItem> */}
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => signOut()}>
                <LogOut />
                Log out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarFooter>
  );
};

export { SideBarFooterCom, SideBarHeaderCom, SideBarMenu };
