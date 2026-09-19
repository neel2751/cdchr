"use client";

import { useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { CameraIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardTitle,
} from "@/components/ui/card";
import { useAvatar } from "@/components/Avatar/AvatarContext";
import { squareImage } from "@/components/Avatar/squareImage";
import {
  publishProfileImage,
  refreshProfileImage,
} from "@/components/Avatar/useProfileImage";
import { useSubmitMutation } from "@/hooks/use-mutate";
import {
  removeMyProfileImage,
  uploadMyProfileImage,
} from "@/server/officeServer/profileImageServer";

const ACCEPT = "image/png,image/jpeg,image/webp";

function initials(name) {
  return (
    String(name || "")
      .split(" ")
      .filter(Boolean)
      .map((part) => part[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?"
  );
}

/**
 * The one thing on this page an employee can change about how they appear.
 *
 * The photo is squared and shrunk in the browser before it is sent, so what
 * leaves the device is a 512px JPEG rather than whatever the phone took. The
 * server enforces the type and the 2 MB cap regardless — this is about not
 * making people upload four megabytes to be shown at forty pixels.
 */
export default function ProfilePhoto() {
  const { newData: record } = useAvatar();
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const { data: session } = useSession();

  const key = record?.profileImage?.key;
  const src = key ? `/api/asset/${key}` : undefined;

  // The sidebar keeps its own cached copy so it does not query on every page.
  // Telling it directly is what makes the change appear there at once instead
  // of whenever that cache next ages out.
  const userId = session?.user?._id;

  const { mutate: upload } = useSubmitMutation({
    mutationFn: async (formData) => await uploadMyProfileImage(formData),
    onSuccessMessage: (message) => message || "Photo updated",
    invalidateKey: ["employeeDeatils"],
    // The new key is minted on the server, so the sidebar is told to go and
    // look rather than handed a value.
    onClose: () => {
      setBusy(false);
      refreshProfileImage(userId);
    },
  });

  const { mutate: remove } = useSubmitMutation({
    mutationFn: async () => await removeMyProfileImage(),
    onSuccessMessage: (message) => message || "Photo removed",
    invalidateKey: ["employeeDeatils"],
    // Removal needs no lookup: the answer is "none".
    onClose: () => {
      setBusy(false);
      publishProfileImage(userId, null);
    },
  });

  async function onPick(event) {
    const file = event.target.files?.[0];
    // Cleared straight away so picking the same file twice still fires change.
    event.target.value = "";
    if (!file) return;

    if (!ACCEPT.split(",").includes(file.type)) {
      toast.error("Use a PNG, JPEG or WebP image");
      return;
    }

    setBusy(true);
    try {
      const squared = await squareImage(file);
      const formData = new FormData();
      formData.append("file", squared);
      upload(formData);
    } catch (error) {
      setBusy(false);
      toast.error(error?.message || "Could not read that image");
    }
  }

  return (
    <Card>
      <CardContent className="flex flex-wrap items-center gap-5 pt-6">
        <Avatar className="h-20 w-20 border">
          <AvatarImage src={src} alt="" className="object-cover" />
          <AvatarFallback className="text-lg">
            {initials(record?.name)}
          </AvatarFallback>
        </Avatar>

        <div className="space-y-1.5">
          <CardTitle className="text-base">Photo</CardTitle>
          <CardDescription>
            Shown to people you work with. Square, and kept small — anything you
            pick is cropped from the middle.
          </CardDescription>
          <div className="flex flex-wrap gap-2 pt-1">
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => inputRef.current?.click()}
            >
              <CameraIcon className="size-3.5 mr-1.5" />
              {busy ? "Working…" : key ? "Replace" : "Add a photo"}
            </Button>
            {key && (
              <Button
                size="sm"
                variant="ghost"
                className="text-rose-600 hover:text-rose-700"
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  remove();
                }}
              >
                <Trash2Icon className="size-3.5 mr-1.5" />
                Remove
              </Button>
            )}
          </div>
        </div>

        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={onPick}
        />
      </CardContent>
    </Card>
  );
}
