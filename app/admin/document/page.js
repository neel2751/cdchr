import FileStructure from "@/components/fileUI";
import React from "react";

export default async function page({ searchParams }) {
  const searchParam = await searchParams;
  return (
    <div className="flex flex-col gap-4 p-4">
      <h1 className="text-2xl font-semibold">Document</h1>
      <div className="flex flex-col gap-4">
        <p className="text-gray-600">
          Document page is under development, please check back later.
        </p>
        <p className="text-gray-600">
          Search Params: {JSON.stringify(searchParam)}
        </p>
      </div>
    </div>
  );
}
