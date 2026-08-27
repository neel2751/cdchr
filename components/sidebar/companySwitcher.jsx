"use client";

import { useEffect, useState, useTransition } from "react";
import { useSession } from "next-auth/react";
import { usePathname } from "next/navigation";
import { Building2, Check, ChevronsUpDown, Loader2 } from "lucide-react";
import { toast } from "sonner";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { SidebarMenuButton } from "../ui/sidebar";
import { getMyTenants } from "@/server/tenantServer/membershipServer";
import { switchDestination } from "@/lib/roleHome";

/**
 * Switch which company the session is acting as.
 *
 * Renders nothing unless the account actually belongs to more than one — most
 * users have a single company and should not see a control that does nothing.
 *
 * The switch itself is a session update; auth.js confirms the membership in the
 * database before applying it, so this component asking for a tenant is a
 * request, not an instruction.
 */
const CompanySwitcher = () => {
  const { data: session, update } = useSession();
  const pathname = usePathname();
  const [tenants, setTenants] = useState([]);
  const [isPending, startTransition] = useTransition();
  const activeId = session?.user?.tenantId;

  useEffect(() => {
    let alive = true;
    (async () => {
      const res = await getMyTenants();
      if (!alive || !res?.success) return;
      setTenants(JSON.parse(res.data).tenants || []);
    })();
    return () => {
      alive = false;
    };
  }, [activeId]);

  if (tenants.length < 2) return null;

  const active = tenants.find((t) => t.tenantId === activeId) || tenants[0];

  const switchTo = (tenantId) => {
    if (tenantId === activeId) return;
    startTransition(async () => {
      await update({ switchTenantId: tenantId });
      const target = tenants.find((t) => t.tenantId === tenantId);
      toast.success(`Switched to ${target?.name || "company"}`);
      // Stay on the page you were on — switching company while looking at Media
      // Management should show that company's media, not send you to the
      // dashboard. Still a full reload, because the tenant decides what every
      // query returns and cached data from the previous company must not
      // survive the switch.
      window.location.assign(switchDestination(pathname, target?.role));
    });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SidebarMenuButton
          size="sm"
          className="border bg-background/60"
          disabled={isPending}
        >
          {isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Building2 className="size-4" />
          )}
          <span className="truncate text-xs">{active?.name}</span>
          <ChevronsUpDown className="ml-auto size-3.5 opacity-60" />
        </SidebarMenuButton>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        className="w-(--radix-dropdown-menu-trigger-width) min-w-56"
        align="start"
      >
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          Your companies
        </DropdownMenuLabel>
        {tenants.map((t) => (
          <DropdownMenuItem
            key={t.tenantId}
            onClick={() => switchTo(t.tenantId)}
            className="gap-2"
          >
            <span className="flex-1 truncate">
              {t.name}
              <span className="ml-1 text-xs text-muted-foreground">
                {t.role}
              </span>
            </span>
            {t.tenantId === activeId && <Check className="size-4" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default CompanySwitcher;
