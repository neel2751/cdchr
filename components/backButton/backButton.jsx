"use client";

import { useRouter } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Returns to the previous page. Detail pages are reached from a list, so
 * history.back() lands where the user expects — including the list's page
 * number and filters, which a fixed href would lose.
 *
 * `fallbackHref` covers an opened-in-new-tab / direct-link visit, where there
 * is no in-app history to go back to.
 */
export default function BackButton({
  fallbackHref = "/admin/dashboard",
  label = "Back",
  className,
}) {
  const router = useRouter();

  const handleBack = () => {
    // A fresh tab starts at length 1; anything more means we navigated here.
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
      return;
    }
    router.push(fallbackHref);
  };

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={handleBack}
      className={className}
    >
      <ArrowLeftIcon className="size-4" />
      {label}
    </Button>
  );
}
