import { Button } from "@/components/ui/button";
import { CardDescription, CardTitle } from "@/components/ui/card";
import { getServerSideProps } from "@/server/session/session";
import { DoorOpen } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import React from "react";

export default async function UnauthPage() {
  const { props } = await getServerSideProps();
  const { user } = props?.session || {};
  const role = user?.role;
  return (
    <main className="flex flex-col items-center justify-center min-h-screen max-w-6xl mx-auto">
      <div className="bg-gradient-to-b from-indigo-50 via-rose-50 p-6 rounded-t-full w-full max-w-md text-center">
        <Image
          src="/images/unauth.svg"
          alt="Unauthorized Access"
          width={300}
          height={300}
          className="mx-auto my-10 animate-pulse"
        />
      </div>
      <CardTitle className="text-2xl font-bold text-gray-900 mb-4 mt-6">
        Unauthorized Access
      </CardTitle>
      <p className="text-gray-700 mb-6 max-w-md text-center">
        You do not have permission to view this page. {/* on new Line */}
        {role === "siteEmployee"
          ? "Please contact your site manager for assistance."
          : "Please log in or contact your administrator."}
      </p>
      {role === "siteEmployee" ? (
        <Button asChild>
          <Link href="/employee">
            <DoorOpen />
            Go to Dashboard
          </Link>
        </Button>
      ) : !role ? (
        <Button asChild>
          <Link
            href="/auth/login"
            className="px-6 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
          >
            Log In
          </Link>
        </Button>
      ) : (
        <Button asChild>
          <Link
            href="/admin/dashboard"
            className="px-6 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
          >
            Go to Admin Dashboard
          </Link>
        </Button>
      )}
    </main>
  );
}
