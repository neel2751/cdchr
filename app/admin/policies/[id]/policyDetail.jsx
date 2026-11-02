"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  Eye,
  EyeOff,
  Loader2,
  Trash2,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useFetchQuery } from "@/hooks/use-query";
import {
  deletePolicy,
  getPolicyById,
  getPolicyCategories,
  setPolicyArchived,
  updatePolicyDetails,
} from "@/server/policyServer/policyServer";
import { describeReviewDue, reviewUrgency } from "@/lib/policies";
import PolicyDetailsForm from "../policyDetailsForm";
import ReviewPanel from "./reviewPanel";
import VersionsPanel from "./versionsPanel";
import VisibilityPanel from "./visibilityPanel";

/**
 * One policy: its versions, who can see it, and what it is called.
 *
 * Versions first, because that is what someone opens a policy to do — put up
 * the new one. Fetched on the client and invalidated by every action below,
 * so publishing a version or changing the audience updates the header badges
 * without a reload.
 */
export default function PolicyDetail({ id }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [confirm, setConfirm] = useState(null); // "archive" | "delete"

  const { data: policy, isLoading, isError } = useQuery({
    queryKey: ["policy", id],
    queryFn: async () => {
      const res = await getPolicyById(id);
      if (!res?.success) throw new Error(res?.message || "Policy not found");
      return JSON.parse(res.data);
    },
    retry: false,
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["policy", id] });
    queryClient.invalidateQueries({ queryKey: ["policies"] });
    queryClient.invalidateQueries({ queryKey: ["policyCategories"] });
    queryClient.invalidateQueries({ queryKey: ["myPolicies"] });
  };

  const { mutate: act, isPending: acting } = useMutation({
    mutationFn: (action) =>
      action === "delete"
        ? deletePolicy(id)
        : setPolicyArchived(id, action === "archive"),
    onSuccess: (res, action) => {
      setConfirm(null);
      if (!res?.success) return toast.error(res?.message || "That did not work");
      toast.success(res.message || "Done");
      refresh();
      if (action === "delete") router.push("/admin/policies");
    },
    onError: (err) => {
      setConfirm(null);
      toast.error(err?.message || "That did not work");
    },
  });

  if (isLoading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError || !policy) {
    return (
      <Card>
        <CardContent className="space-y-3 py-10 text-center">
          <p className="text-sm text-muted-foreground">
            This policy does not exist, or you cannot manage it.
          </p>
          <Button asChild variant="outline">
            <Link href="/admin/policies">Back to policies</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const archived = policy.status === "archived";
  const everPublished = !!policy.currentVersionId;

  const CONFIRM = {
    archive: {
      title: "Archive this policy?",
      body: "It leaves the library and every employee's list. Its versions are kept, and you can restore it later.",
      action: "Archive",
    },
    delete: {
      title: "Delete this policy?",
      body: "It was never published, so there is no history to keep. Any draft file is removed too.",
      action: "Delete",
    },
  }[confirm] || {};

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <Button asChild variant="ghost" size="sm" className="-ml-2">
            <Link href="/admin/policies">
              <ArrowLeft className="mr-1 size-4" />
              Policies
            </Link>
          </Button>
          <h1 className="text-xl font-semibold">{policy.title}</h1>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span>{policy.categoryName}</span>
            <span>·</span>
            {archived ? (
              <Badge variant="secondary">Archived</Badge>
            ) : everPublished ? (
              <Badge>Version {policy.currentVersionNumber} in force</Badge>
            ) : (
              <Badge variant="outline">Not published</Badge>
            )}
            {policy.visibleToEmployees ? (
              <span className="inline-flex items-center gap-1 text-green-700">
                <Eye className="size-3.5" />
                Visible to {policy.audienceCount}{" "}
                {policy.audienceCount === 1 ? "person" : "people"}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1">
                <EyeOff className="size-3.5" />
                Hidden from staff
              </span>
            )}
            {policy.ownerName ? <span>· Owner: {policy.ownerName}</span> : null}
            {policy.status === "active" &&
            reviewUrgency(policy.daysUntilReview) !== "ok" ? (
              <Badge
                variant={
                  reviewUrgency(policy.daysUntilReview) === "overdue"
                    ? "destructive"
                    : "secondary"
                }
              >
                Review: {describeReviewDue(policy.daysUntilReview).toLowerCase()}
              </Badge>
            ) : null}
          </div>
        </div>

        <div className="flex gap-2">
          {archived ? (
            <Button variant="outline" disabled={acting} onClick={() => act("restore")}>
              <ArchiveRestore className="mr-1.5 size-4" />
              Restore
            </Button>
          ) : (
            <Button variant="outline" disabled={acting} onClick={() => setConfirm("archive")}>
              <Archive className="mr-1.5 size-4" />
              Archive
            </Button>
          )}
          {!everPublished ? (
            <Button variant="outline" disabled={acting} onClick={() => setConfirm("delete")}>
              <Trash2 className="mr-1.5 size-4" />
              Delete
            </Button>
          ) : null}
        </div>
      </div>

      <Tabs defaultValue="versions" className="space-y-4">
        <TabsList>
          <TabsTrigger value="versions">Versions</TabsTrigger>
          <TabsTrigger value="visibility">Who can see it</TabsTrigger>
          <TabsTrigger value="review">Review</TabsTrigger>
          <TabsTrigger value="details">Details</TabsTrigger>
        </TabsList>

        <TabsContent value="versions">
          <VersionsPanel policy={policy} />
        </TabsContent>

        {/* Keyed on updatedAt: every save changes it, so both tabs start
            again from what was saved rather than holding the old form. */}
        <TabsContent value="visibility">
          <VisibilityPanel key={policy.updatedAt} policy={policy} />
        </TabsContent>

        <TabsContent value="review">
          <ReviewPanel key={policy.updatedAt} policy={policy} />
        </TabsContent>

        <TabsContent value="details">
          <DetailsTab key={policy.updatedAt} policy={policy} onSaved={refresh} />
        </TabsContent>
      </Tabs>

      <AlertDialog open={!!confirm} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{CONFIRM.title}</AlertDialogTitle>
            <AlertDialogDescription>{CONFIRM.body}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={acting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={acting}
              onClick={(e) => {
                e.preventDefault();
                act(confirm);
              }}
            >
              {CONFIRM.action}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** Title, category, owner and summary, saved together. */
function DetailsTab({ policy, onSaved }) {
  const [details, setDetails] = useState({
    title: policy.title,
    summary: policy.summary,
    categoryId: policy.categoryId,
    ownerId: policy.ownerId,
  });

  const { data: categoryData } = useFetchQuery({
    queryKey: ["policyCategories"],
    fetchFn: getPolicyCategories,
  });
  const categories = categoryData?.newData || [];

  const dirty =
    details.title !== policy.title ||
    (details.summary || "") !== (policy.summary || "") ||
    String(details.categoryId || "") !== String(policy.categoryId || "") ||
    String(details.ownerId || "") !== String(policy.ownerId || "");

  const { mutate, isPending } = useMutation({
    mutationFn: () => updatePolicyDetails(policy._id, details),
    onSuccess: (res) => {
      if (!res?.success) return toast.error(res?.message || "Could not save");
      toast.success(res.message || "Saved");
      onSaved();
    },
    onError: (err) => toast.error(err?.message || "Could not save"),
  });

  return (
    <Card>
      <CardContent className="space-y-6 p-4">
        <PolicyDetailsForm
          value={details}
          onChange={setDetails}
          categories={categories}
        />
        <div className="flex justify-end">
          <Button
            disabled={!dirty || isPending || !details.title?.trim()}
            onClick={() => mutate()}
          >
            Save details
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
