"use client";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { checkPassword } from "@/server/receptionServer/receptionServer";
import { signOut } from "next-auth/react";
import React from "react";
import { toast } from "sonner";

export default function ReceptionLogout() {
  const [open, setOpen] = React.useState(false);
  const handleLogout = async (e) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const password = formData.get("password");
    if (!password) {
      toast.error("Please enter your password to confirm logout.");
      return;
    }
    if (password.length < 8 || password.length > 20) {
      toast.error("Password must be between 8 and 20 characters.");
      return;
    }
    const result = await checkPassword(password);
    if (result.success) {
      setOpen(false);
      signOut();
      //   window.location.href = "/login"; // Redirect to login page
    } else {
      toast.error(result.message || "Invalid password. Please try again.");
    }
    // we need password for the logout
  };
  return (
    <>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="outline">Logout</Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This action will log you out of the system. You will need to log
              in again to access your account.
              <br />
              Are you sure you want to proceed?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => setOpen(true)}
              className="bg-red-500 text-white hover:bg-red-600"
            >
              Continue
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <form onSubmit={handleLogout}>
            <DialogHeader>
              <DialogTitle>Logout Confirmation</DialogTitle>
              <DialogDescription>
                Please enter your password to confirm logout.
              </DialogDescription>
              <Input
                type="password"
                id="password"
                name="password"
                placeholder="Enter your password"
                className="mb-4"
              />
              <Button
                type="submit"
                className="w-full bg-red-500 text-white hover:bg-red-600"
              >
                Confirm Logout
              </Button>
            </DialogHeader>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
