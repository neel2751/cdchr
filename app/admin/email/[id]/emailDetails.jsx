"use client";
import Link from "next/link";
import React from "react";
import { ArrowLeft, LockIcon, PencilIcon, PanelsTopLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import EmailView from "./components/emailView";
import EmailEdit from "./components/emailEdit";
import ChnageEmailPassword from "./components/emailPassword";

/**
 * One email account: what it is set to, how to change it, how to change its
 * password.
 *
 * Rebuilt from a five-tab scaffold that mostly rendered nothing. "Overview" was
 * the literal string "This is a overView"; "Settings" had no content key at all,
 * so it fell through to a placeholder; "View" printed the raw Mongo document
 * through JSON.stringify; and "Edit" was a stub that was not even passed the id
 * of the record it was meant to edit. Landing on this page showed the string.
 *
 * The three tabs left are the three that do something. Each is passed the id.
 */
export default function EmailDetails({ smtpId }) {
  const tabs = [
    {
      value: "overview",
      label: "Overview",
      icon: PanelsTopLeft,
      content: <EmailView smtpId={smtpId} />,
    },
    {
      value: "edit",
      label: "Edit",
      icon: PencilIcon,
      content: <EmailEdit smtpId={smtpId} />,
    },
    {
      value: "password",
      label: "Password",
      icon: LockIcon,
      content: <ChnageEmailPassword smtpId={smtpId} />,
    },
  ];

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link href="/admin/email">
            <ArrowLeft className="mr-1 size-4" />
            Email Settings
          </Link>
        </Button>
        <h1 className="text-lg font-semibold">Email account</h1>
      </div>

      {/* Uncontrolled, with one TabsContent per tab. The previous version kept
          the active tab in React state and rendered a single TabsContent whose
          `value` chased it, which meant the panel was remounted on every switch
          and each tab refetched from scratch. */}
      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList>
          {tabs.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value}>
              <tab.icon className="mr-1.5 size-4 opacity-60" aria-hidden="true" />
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {tabs.map((tab) => (
          <TabsContent key={tab.value} value={tab.value}>
            {tab.content}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
