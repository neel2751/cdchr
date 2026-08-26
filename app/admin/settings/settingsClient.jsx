"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Building2, Check, Globe, Palette } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import BrandingForm from "./brandingForm";
import DomainsPanel from "./domainsPanel";

/**
 * Settings for every company this account owns.
 *
 * One company is selected at a time on the left, and its branding and domains
 * are edited on the right. Deliberately not tied to the session's active
 * company: an owner setting up a domain for each of three businesses should not
 * have to switch the whole app three times.
 */
const SettingsClient = ({ companies, activeTenantId, platformRootDomain }) => {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [selectedId, setSelectedId] = useState(
    // Start on the company they are currently working in, if it is one of them.
    companies.find((c) => c._id === activeTenantId)?._id || companies[0]?._id
  );

  const selected = companies.find((c) => c._id === selectedId) || companies[0];

  /** Run a server action for the selected company, then reload its data. */
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

  if (!selected) return null;

  const multi = companies.length > 1;

  return (
    <div className="p-4 md:p-6">
      <div className="mb-5">
        <h1 className="text-xl font-semibold tracking-tight">
          Company settings
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {multi
            ? `Branding and web address for each of your ${companies.length} companies. Each one has its own domain.`
            : `Branding and web address for ${selected.name}.`}
        </p>
      </div>

      <div className={multi ? "grid gap-5 lg:grid-cols-[220px_1fr]" : ""}>
        {multi && (
          <nav aria-label="Your companies" className="space-y-1">
            <p className="px-2 pb-1 text-xs font-medium uppercase text-muted-foreground">
              Your companies
            </p>
            {companies.map((c) => {
              const isSelected = c._id === selected._id;
              const verified = c.domains.filter((d) => d.verified).length;
              return (
                <button
                  key={c._id}
                  type="button"
                  onClick={() => setSelectedId(c._id)}
                  aria-current={isSelected ? "true" : undefined}
                  className={`w-full rounded-lg border p-2.5 text-left text-sm transition ${
                    isSelected
                      ? "border-primary/40 bg-primary/5"
                      : "hover:bg-muted/60"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <Building2 className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate font-medium">
                      {c.name}
                    </span>
                    {isSelected && <Check className="size-4 text-primary" />}
                  </span>
                  <span className="mt-1 block pl-6 text-xs text-muted-foreground">
                    {verified > 0
                      ? `${verified} domain${verified > 1 ? "s" : ""} live`
                      : c.domains.length
                        ? "domain pending"
                        : "no domain yet"}
                  </span>
                </button>
              );
            })}
          </nav>
        )}

        <div>
          {multi && (
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold">{selected.name}</h2>
              {selected._id === activeTenantId && (
                <Badge variant="secondary">currently working in</Badge>
              )}
            </div>
          )}

          {/* Keyed on the company so switching resets every form to its data
              instead of carrying the previous company's values across. */}
          <Tabs defaultValue="branding" key={selected._id}>
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
              <BrandingForm
                tenant={selected}
                run={run}
                isPending={isPending}
              />
            </TabsContent>

            <TabsContent value="domains">
              <DomainsPanel
                tenant={selected}
                platformRootDomain={platformRootDomain}
                run={run}
                isPending={isPending}
              />
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
};

export default SettingsClient;
