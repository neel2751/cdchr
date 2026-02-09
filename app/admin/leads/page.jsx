import React, { Suspense } from "react";
import LeadDashboard from "./leadDashboard";
import { getLeadsByAgent } from "@/server/leadServer";

// 1. ADD THIS LINE HERE
export const dynamic = "force-dynamic";

export default async function LeadsPage() {
  const response = await getLeadsByAgent();

  if (response && !response.success) {
    return (
      <div className="flex flex-col items-center justify-center h-screen">
        <h1 className="text-4xl font-bold text-red-500 mb-4">Error</h1>
        <p className="text-lg text-gray-700">
          {response.message || "Failed to fetch leads."}
        </p>
      </div>
    );
  }

  // 2. SAFETY CHECK: Ensure response.data exists before parsing
  let result = [];
  try {
    result = response?.data ? JSON.parse(response.data) : [];
  } catch (e) {
    console.error("Failed to parse leads data:", e);
    result = [];
  }

  if (!result || result.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-screen">
        <h1 className="text-4xl font-bold text-gray-500 mb-4">
          No Leads Found
        </h1>
        <p className="text-lg text-gray-700">
          You currently have no leads assigned.
        </p>
      </div>
    );
  }

  return (
    <Suspense fallback={<LoadingState />}>
      <LeadDashboard leads={result} />
    </Suspense>
  );
}

// Optional: Extract loading to a clean component
function LoadingState() {
  return (
    <div className="flex flex-col items-center justify-center h-screen">
      <h1 className="text-4xl font-bold text-gray-500 mb-4">Loading...</h1>
      <p className="text-lg text-gray-700">Fetching your leads, please wait.</p>
    </div>
  );
}
