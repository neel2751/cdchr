"use client";
import { CardTitle } from "@/components/ui/card";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Box,
  House,
  LockIcon,
  PanelsTopLeft,
  PencilIcon,
  Settings,
} from "lucide-react";
import React from "react";

import EmailView from "./components/emailView";
import EmailEdit from "./components/emailEdit";
import ChnageEmailPassword from "./components/emailPassword";

export default function EmailDetails({ smtpId }) {
  const tabs = [
    {
      value: "overview",
      label: "Overview",
      icon: House,
      content: "This is a overView",
    },
    {
      value: "view",
      label: "View",
      icon: PanelsTopLeft,
      content: <EmailView smtpId={smtpId} />,
    },
    {
      value: "edit",
      label: "Edit",
      icon: PencilIcon,
      content: <EmailEdit />,
    },
    {
      value: "settings",
      label: "Settings",
      icon: Settings,
    },
    {
      value: "password",
      label: "Password",
      icon: LockIcon,
      content: <ChnageEmailPassword smtpId={smtpId} />,
    },
  ];

  const [activeTab, setActiveTab] = React.useState(tabs[0].value);

  return (
    <div className="max-w-6xl mx-auto">
      <CardTitle className="text-xl mb-4">Email Details</CardTitle>
      <Tabs defaultValue={activeTab}>
        <ScrollArea>
          <TabsList className="mb-3 h-auto -space-x-px bg-background p-0 shadow-sm shadow-black/5 rtl:space-x-reverse w-full">
            {tabs.map((tab) => (
              <TabsTrigger
                key={tab.value}
                value={tab.value}
                onClick={() => setActiveTab(tab.value)}
                className="relative overflow-hidden rounded-none border border-border py-2 after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 first:rounded-s last:rounded-e data-[state=active]:bg-muted data-[state=active]:after:bg-primary"
              >
                <tab.icon
                  className="-ms-0.5 me-1.5 opacity-60"
                  size={16}
                  strokeWidth={2}
                  aria-hidden="true"
                />
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>
        <TabsContent value={activeTab}>
          {tabs.find((tab) => tab.value === activeTab).content || (
            <div className="p-4">Content for {activeTab} tab.</div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
