// import { verifyDevice } from "@/server/deviceServer/deviceManagementServer";

import { verifyDevice } from "@/server/deviceServer/deviceManagementServer";

// export async function POST(req) {
//   const { employeeId, deviceId } = await req.json();

//   const response = await verifyDevice({ userId: employeeId, deviceId });

//   if (!response.success) {
//     return new Response(JSON.stringify({ message: "Unauthorized access" }), {
//       status: 401,
//       headers: { "Content-Type": "application/json" },
//     });
//   }
//   const user = response.data;

//   if (!user || !user.isActive || user.delete) {
//     return new Response(JSON.stringify({ message: "Unauthorized access" }), {
//       status: 401,
//       headers: { "Content-Type": "application/json" },
//     });
//   }
//   const isActive = user?.isActive || false;

//   // If device lock is OFF, they are authorized by default
//   if (!user.enforceDeviceLock) {
//     return new Response(JSON.stringify({ isActive }), {
//       status: 200,
//       headers: { "Content-Type": "application/json" },
//     });
//   }

//   // Check if the current deviceId is in the approved list
//   const isAuthorized = user.authorizedDevices?.some(
//     (d) => d.deviceId === deviceId
//   );
//   if (!isAuthorized) {
//     return new Response(JSON.stringify({ isActive: false }), {
//       status: 200,
//       headers: { "Content-Type": "application/json" },
//     });
//   }
//   return new Response(JSON.stringify({ isActive }), {
//     status: 200,
//     headers: { "Content-Type": "application/json" },
//   });
// }

export async function POST(req) {
  try {
    const { employeeId, deviceId } = await req.json();

    const response = await verifyDevice({ userId: employeeId, deviceId });

    if (!response.success || !response.authorized) {
      return new Response(
        JSON.stringify({ isActive: false, isAuthorized: false }),
        {
          status: 401, // 401 tells the middleware "Unauthorized"
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const user = response.data;

    // Check if account is still active/not deleted
    if (!user.isActive || user.delete) {
      return new Response(JSON.stringify({ isActive: false }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({ isActive: true, isAuthorized: true }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    return new Response(JSON.stringify({ message: "Server Error" }), {
      status: 500,
    });
  }
}
