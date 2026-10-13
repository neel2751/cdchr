"use client";

import { useEffect, useState, useTransition } from "react";
import { useSession } from "next-auth/react";
import { Building2, Check, Loader2 } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { getMyTenants } from "@/server/tenantServer/membershipServer";
import { homePathForRole } from "@/lib/roleHome";

/** Asked once per sign-in. The key is per browser session, so it clears itself. */
const ASKED_KEY = "companyChoiceAsked";

/**
 * "Which company?", for somebody who works for more than one.
 *
 * Signing in used to land them in whichever company the lookup returned first.
 * That was at least deterministic after the duplicate-login work, but it was
 * still a guess, and a worker who clocks in against the wrong company's payroll
 * has a problem their manager discovers at the end of the month.
 *
 * SHOWN AFTER SIGNING IN, NOT DURING IT. Deliberately: asking before the
 * password is checked would mean answering "which companies does this address
 * belong to" for anybody who types an email, which is an enumeration oracle.
 * Mounted in the app shell instead, so it appears once the session exists —
 * which also puts it after the two-factor gates rather than in front of them.
 *
 * Renders nothing for the overwhelming majority, who have one company.
 */
export default function CompanyChoicePrompt() {
  const { data: session, update } = useSession();
  const [tenants, setTenants] = useState([]);
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const activeId = session?.user?.tenantId;

  const remember = () => {
    try {
      sessionStorage.setItem(ASKED_KEY, "1");
    } catch {
      // Nothing to do; the prompt simply reappears on the next navigation,
      // which is annoying rather than broken.
    }
  };

  useEffect(() => {
    if (!session?.user?._id) return;
    let asked = false;
    try {
      asked = sessionStorage.getItem(ASKED_KEY) === "1";
    } catch {
      // Private browsing, or storage refused. Not asking is the safe failure:
      // the switcher in the sidebar is still there.
      asked = true;
    }
    if (asked) return;

    let alive = true;
    (async () => {
      const res = await getMyTenants();
      if (!alive || !res?.success) return;
      const list = JSON.parse(res.data).tenants || [];
      if (list.length > 1) {
        setTenants(list);
        setOpen(true);
      } else {
        // One company, or none: nothing to ask, and nothing to ask again.
        remember();
      }
    })();
    return () => {
      alive = false;
    };
  }, [session?.user?._id]);

  const choose = (tenant) => {
    remember();
    if (tenant.tenantId === activeId) {
      setOpen(false);
      return;
    }
    startTransition(async () => {
      await update({ switchTenantId: tenant.tenantId });
      // A full load, not a router push: the tenant decides what every query
      // returns, so cached data from the company we were in must not survive.
      window.location.assign(homePathForRole(tenant.role));
    });
  };

  if (!open || tenants.length < 2) return null;

  return (
    <Dialog open onOpenChange={() => {}}>
      <DialogContent className="sm:max-w-sm" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Which company?</DialogTitle>
          <DialogDescription>
            You work for more than one. Pick where to start — you can switch
            later from the sidebar.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          {tenants.map((tenant) => (
            <Button
              key={tenant.tenantId}
              variant="outline"
              className="h-auto w-full justify-start gap-3 py-3"
              disabled={isPending}
              onClick={() => choose(tenant)}
            >
              <Building2 className="size-4 shrink-0 text-muted-foreground" />
              <span className="flex-1 text-left">
                <span className="block font-medium">{tenant.name}</span>
                <span className="block text-xs text-muted-foreground">
                  {tenant.role}
                </span>
              </span>
              {tenant.tenantId === activeId ? (
                <Check className="size-4 shrink-0 text-emerald-600" />
              ) : null}
              {isPending ? (
                <Loader2 className="size-4 shrink-0 animate-spin" />
              ) : null}
            </Button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
