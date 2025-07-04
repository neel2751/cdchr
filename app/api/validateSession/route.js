import LoginTokenModel from "@/models/loginToken";
import { NextResponse } from "next/server";

export async function POST(req) {
  const { id, loginToken } = await req.json();
  try {
    const user = await LoginTokenModel.findOne({ userId: id });
    if (!user || user.loginToken !== loginToken) {
      return NextResponse.json(
        {
          success: false,
          message: "Invalid login token",
        },
        {
          status: 401,
        }
      );
    }
    return NextResponse.json(
      {
        success: true,
        message: "Login token updated successfully",
      },
      {
        status: 200,
      }
    );
  } catch (error) {
    console.log(" Error:", error);
    return NextResponse.json(
      {
        success: false,
        message: "Error updating login token",
      },
      {
        status: 500,
      }
    );
  }
}
