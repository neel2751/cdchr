"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Eye, EyeOff, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  previewPolicyAudience,
  setPolicyVisibility,
} from "@/server/policyServer/policyServer";
import AudienceSelector from "../../announcements/audienceSelector";

/**
 * Who can read this policy: a switch, and an audience behind it.
 *
 * The switch is the decision and the audience is its detail, so the audience
 * can be prepared while the policy is still hidden, and hiding it again does
 * not throw away who it was for.
 *
 * The live count is what makes "Everyone" safe to pick. Showing a policy to
 * the whole company is easy to do by mistake and impossible to notice from a
 * label; "Visible to 214 people" is not.
 *
 * Starts from the saved policy. PolicyDetail remounts it whenever the policy
 * is saved, so it never holds stale settings.
 */
export default function VisibilityPanel({ policy }) {
  const queryClient = useQueryClient();
  const [visible, setVisible] = useState(!!policy.visibleToEmployees);
  const [audience, setAudience] = useState(policy.audience || { mode: "all" });

  const nothingPublished = !policy.currentVersionId;
  const archived = policy.status === "archived";

  const { data: preview } = useQuery({
    queryKey: ["policyAudiencePreview", JSON.stringify(audience)],
    queryFn: async () => {
      const res = await previewPolicyAudience({ audience });
      return res?.data ? JSON.parse(res.data) : { count: 0, sample: [] };
    },
    enabled: visible,
    staleTime: 30_000,
  });

  const dirty =
    visible !== !!policy.visibleToEmployees ||
    JSON.stringify(audience) !== JSON.stringify(policy.audience || { mode: "all" });

  const { mutate, isPending } = useMutation({
    mutationFn: () =>
      setPolicyVisibility(policy._id, { visibleToEmployees: visible, audience }),
    onSuccess: (res) => {
      if (!res?.success) {
        toast.error(res?.message || "Could not save");
        return;
      }
      toast.success(res.message || "Saved");
      queryClient.invalidateQueries({ queryKey: ["policy", policy._id] });
      queryClient.invalidateQueries({ queryKey: ["policies"] });
      queryClient.invalidateQueries({ queryKey: ["myPolicies"] });
    },
    onError: (err) => toast.error(err?.message || "Could not save"),
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex items-start justify-between gap-4 p-4">
          <div className="flex items-start gap-3">
            {visible ? (
              <Eye className="mt-0.5 size-5 text-green-700" />
            ) : (
              <EyeOff className="mt-0.5 size-5 text-muted-foreground" />
            )}
            <div>
              <Label htmlFor="policy-visible" className="text-base">
                Visible to staff
              </Label>
              <p className="text-sm text-muted-foreground">
                {archived
                  ? "Archived policies are hidden. Restore it to show it again."
                  : nothingPublished
                    ? "Publish a version first — there is nothing for staff to read yet."
                    : visible
                      ? "Staff in the audience below see the version in force under Company Policies."
                      : "Only people who manage policies can see it."}
              </p>
            </div>
          </div>
          <Switch
            id="policy-visible"
            checked={visible}
            disabled={(nothingPublished || archived) && !visible}
            onCheckedChange={setVisible}
          />
        </CardContent>
      </Card>

      <Card className={visible ? "" : "opacity-60"}>
        <CardContent className="space-y-4 p-4">
          <AudienceSelector value={audience} onChange={setAudience} officeOnly />
          {visible ? (
            <p className="flex items-center gap-2 rounded-lg bg-neutral-50 px-3 py-2 text-sm">
              <Users className="size-4 text-muted-foreground" />
              {preview
                ? preview.count
                  ? `${preview.count} ${preview.count === 1 ? "person" : "people"}${
                      preview.sample?.length
                        ? `, including ${preview.sample.slice(0, 3).join(", ")}`
                        : ""
                    }`
                  : "Nobody is in this audience yet."
                : "Counting…"}
            </p>
          ) : null}
          <p className="text-xs text-muted-foreground">
            Office staff only for now. Site staff have no app to read policies in
            yet.
          </p>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button
          variant="outline"
          disabled={!dirty || isPending}
          onClick={() => {
            setVisible(!!policy.visibleToEmployees);
            setAudience(policy.audience || { mode: "all" });
          }}
        >
          Reset
        </Button>
        <Button disabled={!dirty || isPending} onClick={() => mutate()}>
          Save
        </Button>
      </div>
    </div>
  );
}
