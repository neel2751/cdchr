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
import { useMyProfileImage } from "@/components/Avatar/useProfileImage";
import SideBarMenuCom from "./sideBarMenu";
import { mergeAndFilterMenus } from "@/lib/object";
import { useBranding } from "@/app/admin/providers";
import CompanySwitcher from "./companySwitcher";
import { useMemo } from "react";

const SideBarHeaderCom = () => {
  // Falls back to the platform defaults from lib/tenant.js when the company has
  // set no branding, so this is safe before any tenant configures anything.
  const branding = useBranding();
  const logo = branding?.logoUrl || "/images/Interiorlogo.svg";
  const appName = branding?.appName || "Hr Management";

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
                  {/* A plain <img>, not next/image: a tenant's logo URL is
                      arbitrary, and next/image only accepts hosts listed in
                      next.config.mjs, which is fixed at build time. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={logo}
                    alt=""
                    width={30}
                    height={30}
                    className="size-[30px] rounded-lg object-contain"
                  />
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">{appName}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {branding?.name || ""}
                  </span>
                </div>
              </SidebarMenuButton>
            </DropdownMenuTrigger>
          </DropdownMenu>
        </SidebarMenuItem>
        {/* Only renders for accounts that belong to more than one company. */}
        <SidebarMenuItem>
          <CompanySwitcher />
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarHeader>
  );
};

const SideBarMenu = () => {
  const pathName = usePathname();
  const { data: sessionData } = useSession();

  // Memoize the path to avoid recalculation
  const rootPath = useMemo(() => pathName.split("/", 3).join("/"), [pathName]);

  // Fetch employee menu (React Query / SWR style)
  const { data: menuItems = [], isLoading } = useFetchSelectQuery({
    fetchFn: getEmployeeMenu,
    queryKey: ["employeeMenu", sessionData?.user?._id],
  });

  // Merge menus and memoize to prevent recalculation on re-render.
  //
  // `hidden` entries are dropped here: they are in COMMONMENUITEMS so proxy.js
  // will let an ordinary employee open those paths, not because anybody should
  // see a link to them. The profile area is reached from the avatar menu below,
  // and the rest are redirects from where these pages used to live.
  //
  // A hardcoded copy of the three personal items used to be spliced in here for
  // role "user" and then de-duplicated against this list. It was dead weight —
  // COMMONMENUITEMS already carries them, and the sidebar does not filter that
  // list by role — and it meant their paths were written down in two files.
  const mergedMenu = useMemo(
    () =>
      mergeAndFilterMenus(COMMONMENUITEMS, menuItems).filter(
        (item) => !item?.hidden,
      ),
    [menuItems],
  );

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
                      {/* `icon` is a component now, not an element — see the
                          note on REPORT in data/menu.js. */}
                      {item?.icon && <item.icon className="w-5 h-5" />}
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
  const branding = useBranding();
  const brandLogo = branding?.logoUrl || "/images/Interiorlogo.svg";

  // Both avatars here used to be the company logo, which made the footer say
  // "you are signed in as this company" rather than "you are signed in as you"
  // — and made every account look identical. The person's own photo belongs
  // here; the logo stays as the fallback, so nothing changes for anyone who has
  // not set one.
  //
  // Read from the browser's own cache, not the database: this renders on every
  // screen and the answer changes about once a year. See useProfileImage.js —
  // it refreshes on its own schedule and the moment the photo is changed.
  const { src: photoSrc } = useMyProfileImage();
  const avatarSrc = photoSrc || brandLogo;
  const avatarFallback = (session?.user?.name || "?")
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

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
                <Avatar className="h-8 w-8 rounded-lg border">
                  <AvatarImage
                    src={avatarSrc}
                    alt=""
                    className="object-cover"
                  />
                  <AvatarFallback className="rounded-lg">
                    {avatarFallback}
                  </AvatarFallback>
                </Avatar>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">
                    {session?.user?.name || branding?.appName || "Hr Management"}
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
                  <Avatar className="h-8 w-8 rounded-lg border">
                    <AvatarImage
                      src={avatarSrc}
                      alt=""
                      className="object-cover"
                    />
                    <AvatarFallback className="rounded-lg">
                      {avatarFallback}
                    </AvatarFallback>
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
                  {/* No id in the link. This page can only ever show the
                      signed-in user their own record, so naming that record in
                      the URL told them nothing and put an identifier in their
                      address bar and browser history for no reason. */}
                  <Link
                    className="flex items-center gap-2 w-full"
                    href="/admin/me/profile"
                  >
                    <BadgeCheck />
                    My Profile
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
