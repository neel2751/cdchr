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
                <div className="flex aspect-square size-8 items-center border border-neutral-200 p-1 justify-center rounded-lg text-sidebar-primary-foreground">
                  <Image
                    // src="/images/cdc.svg"
                    src={
                      "https://res.cloudinary.com/drcjzx0sw/image/upload/v1746444818/hr_jlxx1c.svg"
                    }
                    alt="Logo"
                    width={30}
                    height={30}
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
  const path = pathName.split("/", 3).join("/");
  const currentMenu = getMenu(path);
  const { data } = useSession();
  const { data: menuItems = [], isLoading } = useFetchSelectQuery({
    fetchFn: getEmployeeMenu,
    queryKey: ["employeeMenu", data?.user?._id],
  });

  const menu = mergeAndFilterMenus(COMMONMENUITEMS, menuItems);

  const currentReport = getReportMenu(path);

  return (
    <SidebarContent>
      {/* <SidebarGroup>
        <SideBarMenuCom menuItems={COMMONMENUITEMS} path={path} />
      </SidebarGroup> */}
      {isLoading ? (
        <div>Loading...</div>
      ) : (
        <SidebarGroup>
          <SideBarMenuCom menuItems={menu} path={path} />
        </SidebarGroup>
      )}

      {(data?.user?.role === "superAdmin" || data?.user?.role === "admin") && (
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
      {/* <SidebarMenu className="gap-4">
          <Collapsible asChild className="group/collapsible">
            <SidebarMenuItem>
              <IssueForm />
            </SidebarMenuItem>
          </Collapsible>
        </SidebarMenu> */}
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
                <Avatar className="h-8 w-8 rounded-lg border p-1">
                  <AvatarImage
                    // src={session?.user?.image || "/images/cdc.svg"}
                    src={
                      "https://res.cloudinary.com/drcjzx0sw/image/upload/v1746444818/hr_jlxx1c.svg"
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
                        "https://res.cloudinary.com/drcjzx0sw/image/upload/v1746444818/hr_jlxx1c.svg"
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
                    Current Version : IS/V5.9
                  </span>
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem>
                  <Link
                    className="flex items-center gap-2"
                    href={`/admin/account/${encrypt(
                      session?.user?._id
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
