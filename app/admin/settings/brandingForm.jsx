"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import Image from "next/image";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  updateTenantBranding,
  uploadTenantLogo,
} from "@/server/tenantServer/tenantSettingsServer";

const FIELDS = [
  {
    name: "appName",
    label: "Application name",
    placeholder: "Acme People",
    help: "Shown in the sidebar, the browser tab and outgoing email.",
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
  const router = useRouter();
  const [uploading, setUploading] = useState(false);
  const [values, setValues] = useState(() => ({
    appName: tenant.storedBranding?.appName || "",
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

  /**
   * Upload rather than a pasted URL.
   *
   * next.config.mjs pins img-src and images.remotePatterns, and neither can be
   * extended per request — so a third-party link renders in this preview and
   * then silently fails in production. Uploading stores it under the company's
   * own prefix and serves it from /api/asset, which is first-party.
   */
  const onLogoPicked = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await uploadTenantLogo(tenant._id, body);
      if (res?.success) {
        toast.success(res.message || "Logo uploaded");
        router.refresh();
      } else {
        toast.error(res?.message || "Upload failed");
      }
    } finally {
      setUploading(false);
      e.target.value = "";
    }
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
            <Label htmlFor="logoFile">Logo</Label>
            <div className="flex flex-wrap items-center gap-3">
              <input
                id="logoFile"
                type="file"
                accept="image/png,image/jpeg,image/svg+xml,image/webp"
                disabled={uploading || isPending}
                onChange={onLogoPicked}
                className="text-sm file:mr-3 file:rounded-md file:border file:bg-background file:px-3 file:py-1.5 file:text-sm"
              />
              {uploading && <Loader2 className="size-4 animate-spin" />}
            </div>
            <p className="text-xs text-muted-foreground">
              PNG, JPEG, SVG or WebP, under 1 MB. Stored with your company and
              served from this site, so it works everywhere the app appears.
            </p>
          </div>

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
