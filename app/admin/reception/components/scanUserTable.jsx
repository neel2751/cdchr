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
              </div>
              <Button
                onClick={() => onEdit(user)}
                className="bg-indigo-500 text-white rounded hover:bg-indigo-600"
              >
                Edit
              </Button>
              <Link href={`/admin/reception/${user._id}`} className="ml-2">
                <Button className="bg-green-500 text-white rounded hover:bg-green-600">
                  View
                </Button>
              </Link>
            </CardHeader>
          </Card>
        ))}
      </div>
    </div>
  );
}
