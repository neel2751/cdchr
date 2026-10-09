"use client";

import { signOut } from "next-auth/react";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { Building2, LogOut, Nfc, Receipt, Tags, UserPlus } from "lucide-react";

const PlatformNav = ({ userName }) => {
  return (
    <header className="border-b bg-background">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 p-4">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-lg border bg-muted">
            <Building2 className="size-4" />
          </div>
          <div className="leading-tight">
            <p className="text-sm font-semibold">Platform Console</p>
            <p className="text-xs text-muted-foreground">Tenant management</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/platform/signups">
              <UserPlus className="size-4" />
              <span className="hidden sm:inline">Signups</span>
            </Link>
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/platform/catalogue">
              <Tags className="size-4" />
              <span className="hidden sm:inline">Catalogue</span>
            </Link>
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/platform/tags">
              <Nfc className="size-4" />
              <span className="hidden sm:inline">Tag provisioning</span>
            </Link>
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/platform/billing">
              <Receipt className="size-4" />
              <span className="hidden sm:inline">Billing</span>
            </Link>
          </Button>
          <span className="hidden text-sm text-muted-foreground sm:inline">
            {userName}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => signOut({ callbackUrl: "/auth" })}
          >
            <LogOut className="size-4" />
            Sign out
          </Button>
        </div>
      </div>
    </header>
  );
};

export default PlatformNav;
