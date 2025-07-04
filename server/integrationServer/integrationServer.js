"use server";

import { connect } from "@/db/db";
import { getServerSideProps } from "../session/session";
import MicrosoftIntegration from "@/models/microSoftModel";
import axios from "axios";
import jwt from "jsonwebtoken";
import { getGraphClient } from "@/utils/microsoftGraph";
import MeetingModel from "@/models/meeting/meetingsModel";

export async function checkIntegrationStatus() {
  try {
    const { props } = await getServerSideProps();
    const employeeId = props?.session?.user?._id;
    if (!employeeId) return { success: false, message: "Please login" };
    await connect();
    const res = await MicrosoftIntegration.findOne({ employeeId });
    if (!res) return false;
    if (!res.connected) return false;
    return true;
  } catch (error) {
    console.log(error);
    return false;
  }
}

export async function getAccessTokenForUser() {
  try {
    const { props } = await getServerSideProps();
    const employeeId = props?.session?.user?._id;
    if (!employeeId) return { success: false, message: "Please login" };
    await connect();

    const record = await MicrosoftIntegration.findOne({ employeeId });

    if (!record) throw new Error("No Microsoft account connected");

    if (new Date() < record.expiresAt) {
      return record.accessToken;
    }

    // Refresh flow
    const tokenUrl = `https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT_ID}/oauth2/v2.0/token`;

    const params = new URLSearchParams({
      client_id: process.env.MICROSOFT_CLIENT_ID,
      client_secret: process.env.MICROSOFT_CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: record.refreshToken,
      redirect_uri: process.env.MICROSOFT_REDIRECT_URI,
    });

    const { data } = await axios.post(tokenUrl, params, {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });

    record.accessToken = data.access_token;
    record.refreshToken = data.refresh_token;
    record.expiresAt = new Date(Date.now() + data.expires_in * 1000);
    await record.save();

    return data.access_token;
  } catch (error) {
    console.log(error);
    return false;
  }
}

export async function createTeamsMeeting(title) {
  try {
    const { props } = await getServerSideProps();
    const employeeId = props?.session?.user?._id;
    if (!employeeId) return { success: false, message: "Please login" };
    const creatorEmail = props?.session?.user?.email;
    const token = await getAccessTokenForUser();
    const client = getGraphClient(token);
    const attendances = ["snehal@cdc.construction"];
    await connect();
    const now = new Date();
    const later = new Date(now.getTime() + 30 * 60 * 1000);
    const participateList = attendances.map((email) => ({
      upn: email,
      role: "Attendee",
    }));

    const meeting = await client.api("/me/onlineMeetings").post({
      subject: title,
      startDateTime: now.toISOString(),
      endDateTime: later.toISOString(),
      participants: {
        attendees: participateList, // ✅ Fix here
      },
    });

    const data = {
      employeeId,
      title,
      attendances,
      meetingData: meeting,
      creatorEmail,
      startDateTime: now,
      endDateTime: later,
    };
    const res = await MeetingModel.create(data);
    return { success: true, message: "Meeting is Created" };
  } catch (error) {
    console.log(error);
    return { success: false, message: "Something went wrong" };
  }
}

export async function fetchMe() {
  const token = await getAccessTokenForUser();
  const client = getGraphClient(token);
  const me = await client.api("/me").get();
  const organizerEmail = me.mail || me.userPrincipalName;
  // console.log(me);
  return { success: true, data: JSON.stringify(organizerEmail) };
}

export async function fetchAllUsers() {
  const accessToken = await getAccessTokenForUser();
  const client = getGraphClient(accessToken);
  const result = await client.api("/users").get();
  return { success: true, data: JSON.stringify(result.value) };
}

export async function createMeetingWithInviteOld({ title }) {
  const { props } = await getServerSideProps();
  const employeeId = props?.session?.user?._id;
  if (!employeeId) return { success: false, message: "Please login" };
  const creatorEmail = props?.session?.user?.email;
  const accessToken = await getAccessTokenForUser();
  const client = getGraphClient(accessToken);
  const attendees = ["snehal@cdc.construction"];
  const now = new Date();
  const later = new Date(now.getTime() + 30 * 60 * 1000);

  const attendeeList = attendees.map((email) => ({
    emailAddress: {
      address: email,
      name: email,
    },
    type: "required",
  }));

  const event = await client.api("/me/events").post({
    subject: title,
    start: {
      dateTime: now.toISOString(),
      timeZone: "UTC",
    },
    end: {
      dateTime: later.toISOString(),
      timeZone: "UTC",
    },
    attendees: attendeeList,
    isOnlineMeeting: true,
    onlineMeetingProvider: "teamsForBusiness",
    body: {
      contentType: "HTML",
      content: "Please join this meeting using the link below.",
    },
  });

  console.log(event);

  const data = {
    employeeId,
    title,
    attendances: attendees,
    meetingData: event,
    creatorEmail,
    startDateTime: now,
    endDateTime: later,
  };
  const res = await MeetingModel.create(data);
  return { success: true, message: "Meeting is Created" };
}

export async function createMeetingWithInvite({ title }) {
  const { props } = await getServerSideProps();
  const employeeId = props?.session?.user?._id;
  if (!employeeId) return { success: false, message: "Please login" };

  const creatorEmail = props?.session?.user?.email;
  const accessToken = await getAccessTokenForUser();

  // Decode token to inspect scopes
  const decoded = jwt.decode(accessToken);
  const scopes = decoded?.scp?.split(" ") || [];

  // Check if Calendars.ReadWrite is present
  if (!scopes.includes("Calendars.ReadWrite")) {
    return {
      success: false,
      requireConsent: true,
      message: "Missing calendar permission",
    };
  }

  const client = getGraphClient(accessToken);
  const attendees = ["snehal@cdc.construction"];
  const now = new Date();
  const later = new Date(now.getTime() + 30 * 60 * 1000);

  const attendeeList = attendees.map((email) => ({
    emailAddress: {
      address: email,
      name: email,
    },
    type: "required",
  }));

  const event = await client.api("/me/events").post({
    subject: title,
    start: {
      dateTime: now.toISOString(),
      timeZone: "UTC",
    },
    end: {
      dateTime: later.toISOString(),
      timeZone: "UTC",
    },
    attendees: attendeeList,
    isOnlineMeeting: true,
    onlineMeetingProvider: "teamsForBusiness",
    body: {
      contentType: "HTML",
      content: "Please join this meeting using the link below.",
    },
  });

  const data = {
    employeeId,
    title,
    attendances: attendees,
    meetingData: event,
    creatorEmail,
    startDateTime: now,
    endDateTime: later,
  };

  await MeetingModel.create(data);
  return { success: true, message: "Meeting is Created" };
}
