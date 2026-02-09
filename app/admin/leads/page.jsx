import React from "react";
import LeadDashboard from "./leadDashboard";
import { getLeadsByAgent } from "@/server/leadServer";

export default async function LeadsPage() {
  const response = await getLeadsByAgent();
  const leads = JSON.parse(response?.data);
  return <LeadDashboard leads={leads} />;
}
