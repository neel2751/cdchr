// app/api/auth/microsoft/route.ts

import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { options } from "../[...nextauth]/option";

export async function GET() {
  const session = await getServerSession(options);
  const role = session?.user?.role;
  if (!role) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const commonScope = [
    "offline_access",
    "https://graph.microsoft.com/User.Read",
    "https://graph.microsoft.com/OnlineMeetings.ReadWrite",
    "https://graph.microsoft.com/Calendars.ReadWrite",
  ];

  const scope =
    role === "superAdmin"
      ? commonScope.push("https://graph.microsoft.com/User.Read.All")
      : commonScope;

  console.log(scope);

  const params = new URLSearchParams({
    client_id: process.env.MICROSOFT_CLIENT_ID,
    response_type: "code",
    response_mode: "query",
    redirect_uri: process.env.MICROSOFT_REDIRECT_URI,
    scope: scope.join(" "),
    prompt: "consent",
  });

  return NextResponse.redirect(
    `https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT_ID}/oauth2/v2.0/authorize?${params}`
  );
}
