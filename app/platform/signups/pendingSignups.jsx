"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { toast } from "sonner";
import {
  Check,
  Copy,
  Inbox,
  Loader2,
  MailWarning,
  RefreshCw,
  Clock,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { reissueSignupLink } from "@/server/authServer/signupServer";

/** A date that may be absent, formatted the way the rest of the console does. */
function when(value) {
  if (!value) return "—";
  return format(new Date(value), "d MMM yyyy, HH:mm");
}

/**
 * Signups waiting on a confirmation link.
 *
 * Two groups, and the distinction is the whole point of the screen: a signup
 * flagged `emailFailed` is waiting on *us* — our mailbox would not send its
 * link — while the rest are waiting on the person to click one we did send.
 * Only the first group needs an admin.
 *
 * Reissuing hands back a fresh link, because the stored token is only a hash
 * and the original cannot be recovered. When the mailbox is still down the link
 * comes back to this screen instead, to be passed on by hand — which is what
 * lets signup keep the record rather than discarding it on a failed send.
 */
const PendingSignups = ({ rows = [], rootDomain = "", error = "" }) => {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  // Which row is in flight, so one spinner does not appear on every button.
  const [busyId, setBusyId] = useState("");
  // A link we could not email, held for the admin to copy.
  const [manualLink, setManualLink] = useState(null);
  const [copied, setCopied] = useState(false);

  const waitingOnUs = rows.filter((row) => row.emailFailed);

  const reissue = (row) => {
    setBusyId(row._id);
    startTransition(async () => {
      const res = await reissueSignupLink(row._id);
      setBusyId("");

      if (!res?.success) {
        return toast.error(res?.message || "Could not reissue the link");
      }
      if (res.emailed) {
        toast.success(res.message);
      } else {
        // Nothing was delivered, so a toast that disappears is not enough —
        // the link is the only copy and it is on this screen.
        toast.warning(res.message);
        setManualLink({ email: row.email, link: res.link });
        setCopied(false);
      }
      router.refresh();
    });
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(manualLink.link);
      setCopied(true);
      toast.success("Link copied");
    } catch {
      // Clipboard access can be refused; the link is on screen to select.
      toast.error("Could not copy — select the link and copy it manually");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            Pending signups
          </h1>
          <p className="text-muted-foreground text-sm">
            Workspaces someone has asked for but not confirmed yet. Nothing is
            created until the link is clicked.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => router.refresh()}
          disabled={isPending}
        >
          <RefreshCw className="size-4" />
          Refresh
        </Button>
      </div>

      {error ? (
        <Card>
          <CardContent className="text-destructive py-6 text-sm">
            {error}
          </CardContent>
        </Card>
      ) : null}

      {waitingOnUs.length > 0 ? (
        <Card className="border-amber-300 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-950/30">
          <CardContent className="flex items-start gap-3 py-4 text-sm">
            <MailWarning className="mt-0.5 size-4 shrink-0 text-amber-600" />
            <p>
              <strong>
                {waitingOnUs.length}{" "}
                {waitingOnUs.length === 1 ? "person is" : "people are"} waiting
                on us.
              </strong>{" "}
              Their confirmation email could not be sent, so their signup is
              held here. Reissue the link to try again — if email is still
              failing you will be given the link to send yourself.
            </p>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {rows.length} outstanding{" "}
            {rows.length === 1 ? "signup" : "signups"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <div className="text-muted-foreground flex flex-col items-center gap-2 py-10 text-sm">
              <Inbox className="size-6" />
              <p>Nobody is waiting on a confirmation link.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Company</TableHead>
                    <TableHead>Who</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Link sent</TableHead>
                    <TableHead>Expires</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row._id}>
                      <TableCell>
                        <p className="font-medium">{row.companyName}</p>
                        <p className="text-muted-foreground text-xs">
                          {rootDomain ? `${row.slug}.${rootDomain}` : row.slug}
                        </p>
                      </TableCell>
                      <TableCell>
                        <p>{row.name}</p>
                        <p className="text-muted-foreground text-xs">
                          {row.email}
                        </p>
                      </TableCell>
                      <TableCell>
                        {row.emailFailed ? (
                          <Badge variant="destructive" className="gap-1">
                            <MailWarning className="size-3" />
                            Email failed
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="gap-1">
                            <Clock className="size-3" />
                            Awaiting click
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {when(row.lastSentAt)}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {when(row.expiresAt)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant={row.emailFailed ? "default" : "outline"}
                          size="sm"
                          onClick={() => reissue(row)}
                          disabled={isPending}
                        >
                          {busyId === row._id ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            <RefreshCw className="size-4" />
                          )}
                          Reissue link
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={!!manualLink}
        onOpenChange={(open) => !open && setManualLink(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send this link yourself</DialogTitle>
            <DialogDescription>
              Email is still not working, so this link was not delivered. Send
              it to {manualLink?.email} by any other means — it is valid for 24
              hours and works once.
            </DialogDescription>
          </DialogHeader>

          <p className="bg-muted rounded-md border p-3 font-mono text-xs break-all">
            {manualLink?.link}
          </p>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setManualLink(null)}>
              Close
            </Button>
            <Button onClick={copyLink}>
              {copied ? (
                <Check className="size-4" />
              ) : (
                <Copy className="size-4" />
              )}
              {copied ? "Copied" : "Copy link"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default PendingSignups;
