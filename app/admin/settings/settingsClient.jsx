"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Palette, Globe } from "lucide-react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import BrandingForm from "./brandingForm";
import DomainsPanel from "./domainsPanel";

/**
 * Company settings shell.
 *
 * State lives here so both tabs refresh from one place after a write — the
 * server component reloads via router.refresh(), which re-runs getMyTenant().
 */
const SettingsClient = ({ tenant }) => {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [tab, setTab] = useState("branding");

  /** Run a server action, surface the result, and reload the page data. */
  const run = (action, { onSuccess } = {}) =>
    startTransition(async () => {
      const res = await action();
      if (res?.success) {
        toast.success(res.message || "Saved");
        onSuccess?.(res);
        router.refresh();
      } else {
        toast.error(res?.message || "Something went wrong");
      }
    });

  return (
    <div className="p-4 md:p-6">
      <div className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">
          Company settings
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Branding and web address for{" "}
          <span className="font-medium text-foreground">{tenant.name}</span>.
        </p>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="branding" className="gap-2">
            <Palette className="size-4" />
            Branding
          </TabsTrigger>
          <TabsTrigger value="domains" className="gap-2">
            <Globe className="size-4" />
            Domains
          </TabsTrigger>
        </TabsList>

        <TabsContent value="branding">
          <BrandingForm tenant={tenant} run={run} isPending={isPending} />
        </TabsContent>

        <TabsContent value="domains">
          <DomainsPanel tenant={tenant} run={run} isPending={isPending} />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default SettingsClient;
