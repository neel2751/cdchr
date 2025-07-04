import React from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { EmployeeTimeOff } from "@/data/timeoff";
import { Building } from "lucide-react";

export default function SiteInfo() {
  /*
    Note: We have to do this only for site worker
    Task --> #1 Find total number of the worker only for today date(use new Date())
             #2 Find the total employee from the Assign site from today date
             #3 Make filter here for admin can change the site wise data to see the data depend on the site
    */

  const employeeSite = {
    name: "Jhone",
    location: "London",
    managerId: 1,
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">Site Information</CardTitle>
        <Building className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">
          {employeeSite?.name || "Unassigned"}
        </div>
        <p className="text-xs text-muted-foreground">
          {employeeSite?.location || ""}
        </p>
        <div className="mt-4">
          <p className="text-sm">
            Site Manager:{" "}
            <span className="font-medium">
              {employeeSite
                ? EmployeeTimeOff.find(
                    (emp) => emp.id === employeeSite.managerId
                  )?.name || "Unassigned"
                : "N/A"}
            </span>
          </p>
          <p className="text-sm">
            {/* Department: <span className="font-medium">{currentUser.department}</span> */}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
