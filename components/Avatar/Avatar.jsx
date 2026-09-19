import React from "react";
import { Avatar, AvatarFallback, AvatarImage } from "../ui/avatar";
import { useAvatar } from "./AvatarContext";
import { cn } from "@/lib/utils";

/**
 * An employee's picture, or their initials.
 *
 * AvatarList was removed from this file: a strip of fourteen stock Cloudinary
 * faces that wrote the chosen one to a single shared localStorage key. It was
 * presented as "pick an avatar", but the value was per-browser rather than per
 * person, so it showed the same stranger's face on every employee's record and
 * changed for everyone the moment anybody picked again. Employees upload their
 * own photo now; nothing is left to pick.
 */
const UserAvatar = ({ fallbackName, className }) => {
  const { newData } = useAvatar();
  const key = newData?.profileImage?.key;

  return (
    <Avatar className={cn("h-20 w-20", className)}>
      {key && (
        <AvatarImage
          src={`/api/asset/${key}`}
          alt={fallbackName}
          className="object-cover"
        />
      )}
      <AvatarFallback>{initials(fallbackName)}</AvatarFallback>
    </Avatar>
  );
};

/**
 * Up to two letters. Guarded because the old version did
 * `fallbackName.split(" ")` on a prop that is frequently undefined while the
 * record is still loading, which threw rather than showing a placeholder.
 */
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

export { UserAvatar };
