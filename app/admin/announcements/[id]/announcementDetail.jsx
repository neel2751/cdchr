"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import AnnouncementForm from "../announcementForm";
import RecipientsReport from "../recipientsReport";

/**
 * The two things an author does with an existing announcement: change it, and
 * find out who has read it. Tabs rather than two routes so switching between
 * them does not reload the form and lose unsaved edits.
 *
 * The header sits above the tabs, so the form is told not to draw its own —
 * otherwise the title and back link would appear inside the Edit tab only.
 */
export default function AnnouncementDetail({ announcement }) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link href="/admin/announcements">
            <ArrowLeft className="mr-1 size-4" />
            Announcements
          </Link>
        </Button>
        <h1 className="text-lg font-semibold">{announcement.title}</h1>
        <Badge variant="outline">{announcement.status}</Badge>
      </div>

      <Tabs defaultValue="edit" className="space-y-4">
        <TabsList>
          <TabsTrigger value="edit">Edit</TabsTrigger>
          <TabsTrigger value="recipients">Recipients</TabsTrigger>
        </TabsList>
        <TabsContent value="edit">
          <AnnouncementForm announcement={announcement} showHeader={false} />
        </TabsContent>
        <TabsContent value="recipients">
          <RecipientsReport
            announcementId={announcement._id}
            status={announcement.status}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
