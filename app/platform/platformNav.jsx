"use client";

import { signOut } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Building2, LogOut } from "lucide-react";

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
