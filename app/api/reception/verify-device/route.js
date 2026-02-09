import { verifyDevice } from "@/server/deviceServer/deviceManagementServer";

export async function POST(req) {
  const { employeeId, deviceId } = await req.json();
  console.log(
    "Verifying device for employeeId:",
    employeeId,
    "with deviceId:",
    deviceId
  );

  const response = await verifyDevice({ userId: employeeId, deviceId });

  if (!response.success) {
    return new Response(JSON.stringify({ message: "Unauthorized access" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  const user = response.data;

  if (!user || !user.isActive || user.delete) {
    return new Response(JSON.stringify({ message: "Unauthorized access" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  const isActive = user?.isActive || false;

  // If device lock is OFF, they are authorized by default
  if (!user.enforceDeviceLock) {
    return new Response(JSON.stringify({ isActive }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Check if the current deviceId is in the approved list
  const isAuthorized = user.authorizedDevices?.some(
    (d) => d.deviceId === deviceId
  );
  if (!isAuthorized) {
    return new Response(JSON.stringify({ isActive: false }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  return new Response(JSON.stringify({ isActive }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
