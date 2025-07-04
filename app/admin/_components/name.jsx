"use client";

import { CardTitle } from "@/components/ui/card";
import { useSession } from "next-auth/react";

export default function CardName() {
  const { data: session, status } = useSession();
  // check time to show morning, afternoon, evening
  const date = new Date();
  const hours = date.getHours();
  const timeOfDay =
    hours >= 5 && hours < 12
      ? "Morning"
      : hours >= 12 && hours < 17
      ? "Afternoon"
      : hours >= 17 && hours < 20
      ? "Evening"
      : "Night";
  return (
    <div className="flex items-center gap-1 ms-1 text-base">
      {status === "authenticated" && (
        <div className="h-2 w-2 rounded-full bg-green-700 animate-pulse"></div>
      )}
      <CardTitle>
        Good {timeOfDay}, {session?.user?.name} 👋
      </CardTitle>
    </div>
  );
}
