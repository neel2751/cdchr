import React from "react";
import Dashboard from "./components/dashboard";
import { CardTitle } from "@/components/ui/card";

export default function page() {
  return (
    <div className="container mx-auto p-6">
      <CardTitle>Dashboard</CardTitle>
      <div className="mt-4">
        <Dashboard />
      </div>
    </div>
  );
}
