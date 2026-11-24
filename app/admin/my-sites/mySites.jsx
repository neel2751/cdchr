"use client";

import { format } from "date-fns";
import { AlertTriangle, Loader2, MapPin } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useFetchQuery } from "@/hooks/use-query";
import { useTerms } from "@/app/admin/providers";
import { getMySites } from "@/server/siteAssignmentServer/mySitesServer";

const STATUS_STYLE = {
  In: "bg-emerald-100 text-emerald-800",
  Left: "bg-neutral-100 text-neutral-700",
  "Not arrived": "bg-amber-100 text-amber-800",
  "Not due today": "bg-transparent text-muted-foreground",
};

/**
 * A place manager's own page — "My Classes" for a class teacher, "My Sites"
 * for a site manager. The places they run, who belongs to each, who is in
 * today, and anything about a person they must not miss.
 *
 * What it may show is decided on the server (getMySites): medical notes when
 * the company records them, contact details only when the company allows it.
 */
export default function MySites() {
  const { t, fill } = useTerms();
  const { data, isLoading, error } = useFetchQuery({
    fetchFn: getMySites,
    queryKey: ["mySites"],
    refetchInterval: 60 * 1000,
  });
  const page = data?.newData || {};
  const sites = page.sites || [];

  return (
    <div className="p-4 space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{t("mySites")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {fill("The {sites} you run, who is in today, and what to know about them.")}
          {page.today && ` ${format(new Date(page.today), "EEEE d MMMM")}.`}
        </p>
      </div>

      {isLoading && (
        <div className="flex justify-center py-12">
          <Loader2 className="size-5 animate-spin" />
        </div>
      )}
      {error && (
        <p className="text-sm text-destructive">
          {error.message || "Could not load this page"}
        </p>
      )}
      {!isLoading && !error && sites.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {fill(
              "You do not manage any {sites} at the moment. An administrator adds you on the {SiteManagers} screen.",
            )}
          </CardContent>
        </Card>
      )}

      {sites.map((site) => (
        <SiteCard
          key={site.siteId}
          site={site}
          page={page}
          fill={fill}
        />
      ))}
    </div>
  );
}

function Stat({ label, value, tone }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-2xl font-semibold tabular-nums ${tone || ""}`}>
        {value}
      </p>
    </div>
  );
}

function SiteCard({ site, page, fill }) {
  const { showContacts, showMedical, breakdownLabel } = page;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <MapPin className="size-4" />
          {site.siteName}
        </CardTitle>
        {site.siteAddress && (
          <CardDescription>{site.siteAddress}</CardDescription>
        )}
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="On the books" value={site.headcount} />
          <Stat label="Due today" value={site.expectedToday} />
          <Stat label="In now" value={site.inNow} tone="text-emerald-700" />
          <Stat
            label="Not arrived"
            value={Math.max(
              0,
              site.expectedToday -
                site.people.filter((p) => p.expected && p.clockIn).length,
            )}
            tone="text-amber-700"
          />
        </div>

        {site.breakdown.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              By {breakdownLabel}
            </p>
            <div className="flex flex-wrap gap-2">
              {site.breakdown.map((b) => (
                <Badge key={b.label} variant="outline">
                  {b.label} · {b.count}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {site.people.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {fill("Nobody is on this {site} yet.")}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  {breakdownLabel && <TableHead>{breakdownLabel}</TableHead>}
                  <TableHead>Today</TableHead>
                  <TableHead>In / out</TableHead>
                  {showMedical && <TableHead>Medical and allergies</TableHead>}
                  {showContacts && <TableHead>Contact</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {site.people.map((p) => (
                  <TableRow key={p.employeeId}>
                    <TableCell className="font-medium">
                      {p.name}
                      {p.ongoing && (
                        <Badge variant="secondary" className="ml-2">
                          Ongoing
                        </Badge>
                      )}
                    </TableCell>
                    {breakdownLabel && <TableCell>{p.group}</TableCell>}
                    <TableCell>
                      <span
                        className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[p.status] || ""}`}
                      >
                        {p.status}
                      </span>
                    </TableCell>
                    <TableCell className="tabular-nums text-sm">
                      {p.clockIn ? `${p.clockIn} – ${p.clockOut || "…"}` : "-"}
                    </TableCell>
                    {showMedical && (
                      <TableCell className="max-w-xs text-sm">
                        {p.medicalNotes ? (
                          <span className="flex items-start gap-1.5 text-rose-700">
                            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                            {p.medicalNotes}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                    )}
                    {showContacts && (
                      <TableCell className="text-sm">
                        <ContactCell contacts={p.contacts} />
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {(site.joined.length > 0 || site.left.length > 0) && (
          <div className="grid gap-3 sm:grid-cols-2 text-sm">
            <Recent title="Joined in the last two weeks" rows={site.joined} />
            <Recent title="Left in the last two weeks" rows={site.left} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ContactCell({ contacts }) {
  if (!contacts) return "-";
  const guardian = [contacts.guardianName, contacts.guardianRelation && `(${contacts.guardianRelation})`]
    .filter(Boolean)
    .join(" ");
  return (
    <div className="space-y-0.5">
      {contacts.phone && <div>{contacts.phone}</div>}
      {contacts.email && <div className="text-muted-foreground">{contacts.email}</div>}
      {guardian && (
        <div>
          {guardian}
          {contacts.guardianPhone && ` · ${contacts.guardianPhone}`}
        </div>
      )}
      {!contacts.phone && !contacts.email && !guardian && "-"}
    </div>
  );
}

function Recent({ title, rows }) {
  if (!rows.length) return null;
  return (
    <div className="rounded-lg border p-3">
      <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      <ul className="space-y-0.5">
        {rows.map((r, i) => (
          <li key={`${r.name}-${i}`} className="flex justify-between gap-3">
            <span>{r.name}</span>
            <span className="text-muted-foreground">
              {format(new Date(r.date), "d MMM")}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
