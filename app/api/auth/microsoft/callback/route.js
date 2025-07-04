// app/api/auth/microsoft/callback/route.ts

import { NextResponse } from "next/server";
import axios from "axios";
import { connect } from "@/db/db";
import MicrosoftIntegration from "@/models/microSoftModel";
import { getServerSession } from "next-auth";
import { options } from "../../[...nextauth]/option";

export async function GET(req) {
  const code = req.nextUrl.searchParams.get("code");
  const returnTo =
    req.nextUrl.searchParams.get("return_to") || "/admin/integrations";
  const session = await getServerSession(options);
  if (!session?.user?.email) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  const employeeId = session.user._id; // or your user ID

  if (!code || !employeeId)
    return NextResponse.json(
      { error: "Missing code or user" },
      { status: 400 }
    );

  const tokenUrl = `https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT_ID}/oauth2/v2.0/token`;

  const params = new URLSearchParams({
    client_id: process.env.MICROSOFT_CLIENT_ID,
    client_secret: process.env.MICROSOFT_CLIENT_SECRET,
    grant_type: "authorization_code",
    code,
    redirect_uri: process.env.MICROSOFT_REDIRECT_URI,
  });

  try {
    const { data } = await axios.post(tokenUrl, params, {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });
    const { access_token, refresh_token, expires_in } = data;
    await connect();

    await MicrosoftIntegration.findOneAndUpdate(
      { employeeId },
      {
        connected: true,
        accessToken: access_token,
        refreshToken: refresh_token,
        tokenExpiresAt: new Date(Date.now() + expires_in * 1000),
      },
      { upsert: true }
    );
    return NextResponse.redirect(
      `${process.env.NEXTAUTH_URL}${returnTo}?connected=1`
    );
  } catch (error) {
    console.error("OAuth Error:", error.response?.data || error.message);
    return new NextResponse("OAuth error", { status: 500 });
  }
}
