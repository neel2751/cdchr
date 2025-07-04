"use client";
import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";
import { signOut } from "next-auth/react";

export default function Logout() {
  return (
    <Button size="sm" onClick={() => signOut()}>
      <LogOut />
      Logout
    </Button>
  );
}
