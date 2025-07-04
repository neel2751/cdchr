// app/actions/dashboard.ts
"use server";

import { fetchCardData } from "@/server/dashboardServer/dashboardServer";

export async function getDashboardDataServer() {
  return await fetchCardData();
}
