import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import React from "react";

export default function CompanyWiseCountCard({ data }) {
  return (
    <div className="overflow-hidden">
      <div
        className="
        grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 p-4
        overflow-x-auto
        "
      >
        {data && data.length > 0 ? (
          data.map((item, i) => (
            <Card key={i}>
              <CardHeader>
                <CardTitle className="text-gray-800">
                  {item.companyName}
                </CardTitle>
                <CardDescription>
                  <div className="text-2xl font-bold text-cyan-600">
                    {item.employeeCount}
                  </div>
                  <div className="text-sm text-gray-500">Employees</div>
                </CardDescription>
              </CardHeader>
            </Card>
          ))
        ) : (
          <div className="text-center text-gray-500">No Company Data Found</div>
        )}
      </div>
    </div>
  );
}
