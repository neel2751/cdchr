"use client";

import { useState } from "react";
import Image from "next/image";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateTenantBranding } from "@/server/tenantServer/tenantSettingsServer";

const FIELDS = [
  {
    name: "appName",
    label: "Application name",
    placeholder: "Acme People",
    help: "Shown in the sidebar, the browser tab and outgoing email.",
  },
  {
    name: "logoUrl",
    label: "Logo URL",
    placeholder: "/images/Interiorlogo.svg",
    help: "Square works best. Upload to your own storage and paste the link.",
  },
  {
    name: "faviconUrl",
    label: "Favicon URL",
    placeholder: "/favicon.ico",
  },
  {
    name: "supportEmail",
    label: "Support email",
    placeholder: "support@acme.com",
    help: "Used in the footer of emails the system sends.",
    type: "email",
  },
  {
    name: "emailFromName",
    label: "Email sender name",
    placeholder: "Acme HR",
    help: "The name recipients see. Defaults to the application name.",
  },
];

const BrandingForm = ({ tenant, run, isPending }) => {
  const [values, setValues] = useState(() => ({
    appName: tenant.storedBranding?.appName || "",
    logoUrl: tenant.storedBranding?.logoUrl || "",
    faviconUrl: tenant.storedBranding?.faviconUrl || "",
    supportEmail: tenant.storedBranding?.supportEmail || "",
    emailFromName: tenant.storedBranding?.emailFromName || "",
    primaryColor: tenant.storedBranding?.primaryColor || "",
  }));

  const set = (name, value) => setValues((v) => ({ ...v, [name]: value }));

  const onSubmit = (e) => {
    e.preventDefault();
    run(() => updateTenantBranding(tenant._id, values));
  };

  // Falls back to the platform default so the preview always shows something.
  const previewLogo = values.logoUrl || tenant.branding.logoUrl;
  const previewName = values.appName || tenant.branding.appName;

  return (
    <form onSubmit={onSubmit} className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="text-base">Branding</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {FIELDS.map((f) => (
            <div key={f.name} className="space-y-1.5">
              <Label htmlFor={f.name}>{f.label}</Label>
              <Input
                id={f.name}
                type={f.type || "text"}
                value={values[f.name]}
                placeholder={f.placeholder}
                onChange={(e) => set(f.name, e.target.value)}
              />
              {f.help && (
                <p className="text-xs text-muted-foreground">{f.help}</p>
              )}
            </div>
          ))}

          <div className="space-y-1.5">
            <Label htmlFor="primaryColor">Primary colour</Label>
            <div className="flex items-center gap-3">
              <Input
                id="primaryColor"
                value={values.primaryColor}
                placeholder="oklch(0.55 0.21 258) or #4f46e5"
                onChange={(e) => set("primaryColor", e.target.value)}
              />
              <span
                aria-hidden
                className="size-9 shrink-0 rounded-md border"
                style={{ background: values.primaryColor || "var(--primary)" }}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Any CSS colour. Applied to buttons and highlights across the app.
            </p>
          </div>

          <div className="flex items-center gap-3 pt-1">
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="size-4 animate-spin" />}
              Save branding
            </Button>
            <p className="text-xs text-muted-foreground">
              Changes apply on the next page load.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className="h-fit">
        <CardHeader>
          <CardTitle className="text-base">Preview</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border p-3">
            <div className="flex items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-lg border bg-background">
                {/* Arbitrary user-supplied URLs cannot go through next/image,
                    whose remotePatterns allowlist is fixed at build time. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={previewLogo}
                  alt=""
                  className="size-6 rounded object-contain"
                />
              </div>
              <div className="leading-tight">
                <p className="truncate text-sm font-semibold">{previewName}</p>
                <p className="text-xs text-muted-foreground">Sidebar header</p>
              </div>
            </div>
            <Button
              type="button"
              className="mt-4 w-full"
              style={
                values.primaryColor
                  ? { backgroundColor: values.primaryColor }
                  : undefined
              }
            >
              Primary button
            </Button>
          </div>
        </CardContent>
      </Card>
    </form>
  );
};

export default BrandingForm;
