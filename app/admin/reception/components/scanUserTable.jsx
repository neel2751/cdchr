import { TableStatus } from "@/components/tableStatus/status";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import Link from "next/link";
import React from "react";

export default function ScanUserTable({ data, onEdit }) {
  if (!data?.length) {
    // Reception accounts are now a distinct kind of account rather than every
    // office employee, so this list is empty until one is added. An empty grid
    // reads as broken; saying why does not.
    return (
      <div className="rounded-md border border-dashed p-6 text-center">
        <p className="text-sm font-medium">No reception desks yet</p>
        <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
          A reception desk is the account a front desk signs in as, separate
          from ordinary office staff. Add one to give it an office and register
          the screens it runs on, so attendance scanned there is recorded at
          the right office.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {data.map((user) => (
          <Card key={user.id} className="w-full">
            <CardHeader className="flex items-center justify-between">
              <div className="space-y-1">
                <CardTitle className="text-lg font-semibold">
                  {user.name}
                </CardTitle>
                <TableStatus isActive={user.isActive} />
                <CardDescription className="text-sm text-muted-foreground">
                  {user.email}
                </CardDescription>
                {/* Shown on the card so an administrator can see at a glance
                    which desks are set up, without opening each one. The two
                    lines are the two places an office can come from, in the
                    order the desk resolves them. */}
                <p className="text-xs text-muted-foreground">
                  {user.clockLocationId?.name ? (
                    <>
                      Office: <strong>{user.clockLocationId.name}</strong>
                    </>
                  ) : (
                    <span className="text-amber-700">
                      No office — the desk asks whoever is standing at it
                    </span>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  {user.authorizedDevices?.length
                    ? `${user.authorizedDevices.length} screen${
                        user.authorizedDevices.length === 1 ? "" : "s"
                      } registered` +
                      (user.authorizedDevices.some((d) => d.locationId)
                        ? ""
                        : " (none set to an office)")
                    : "No screens registered"}
                </p>
              </div>
              <Button
                onClick={() => onEdit(user)}
                className="bg-indigo-500 text-white rounded hover:bg-indigo-600"
              >
                Edit
              </Button>
              {/* "View" said nothing about what was behind it. This is where
                  a desk's screens are registered, and where each one is told
                  which office it stands in. */}
              <Link href={`/admin/reception/${user._id}`} className="ml-2">
                <Button className="bg-green-500 text-white rounded hover:bg-green-600">
                  Screens &amp; devices
                </Button>
              </Link>
            </CardHeader>
          </Card>
        ))}
      </div>
    </div>
  );
}
