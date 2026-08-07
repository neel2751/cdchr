import { Card } from "@/components/ui/card";
import {
  CalendarClockIcon,
  ShieldAlertIcon,
  UserCheckIcon,
  UserMinusIcon,
} from "lucide-react";
import React from "react";

/**
 * Four compact headline counts for the office employee page. The numbers follow
 * the company filter, so they always describe the list underneath them.
 */
export default function CompanyWiseCountCard({ data, companyName }) {
  const stats = [
    {
      label: "Active",
      value: data?.active,
      icon: UserCheckIcon,
      accent: "text-emerald-600",
      tint: "bg-emerald-50",
    },
    {
      label: "Inactive",
      value: data?.inactive,
      icon: UserMinusIcon,
      accent: "text-neutral-600",
      tint: "bg-neutral-100",
    },
    {
      label: "Visa expiring",
      value: data?.visaExpiring,
      icon: CalendarClockIcon,
      accent: "text-amber-600",
      tint: "bg-amber-50",
      hint: "next 90 days",
    },
    {
      label: "Visa expired",
      value: data?.visaExpired,
      icon: ShieldAlertIcon,
      accent: "text-red-600",
      tint: "bg-red-50",
    },
  ];

  return (
    <div className="px-4 pt-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {stats.map((stat) => (
          <Card key={stat.label} className="p-3">
            <div className="flex items-center gap-3">
              <span className={`rounded-md p-1.5 ${stat.tint}`}>
                <stat.icon className={`size-4 ${stat.accent}`} />
              </span>
              <div className="min-w-0">
                <div className={`text-xl font-semibold ${stat.accent}`}>
                  {stat.value ?? "-"}
                </div>
                <div className="text-xs text-neutral-500 truncate">
                  {stat.label}
                  {stat.hint && (
                    <span className="text-neutral-400"> ({stat.hint})</span>
                  )}
                </div>
              </div>
            </div>
          </Card>
        ))}
      </div>
      <p className="text-xs text-neutral-500 mt-2">
        Showing {companyName ? `${companyName} only` : "all companies"}
      </p>
    </div>
  );
}
