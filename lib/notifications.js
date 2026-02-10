import { saveSubscription } from "@/server/attendanceServer/notificationServer";

function urlBase64ToUnit8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/\-/g, "+")
    .replace(/_/g, "/");

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

// export const subscriberUser = async (userId) => {
//   if (typeof window === "undefined" || !("serviceWorker" in navigator))
//     return false;

//   if ("serviceWorker" in navigator) {
//     const registration = await navigator.serviceWorker.register("/sw.js");
//     const permission = await Notification.requestPermission();

//     if (permission === "granted") {
//       const subscribeOptions = {
//         userVisibleOnly: true,
//         applicationServerKey: urlBase64ToUnit8Array(
//           process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
//         ),
//       };
//       const subscription = await registration.pushManager.subscribe(
//         subscribeOptions
//       );

//       const response = await saveSubscription(userId, subscription);
//       console.log("Subscription saved response:", response);
//       if (response) return true;
//     }
//   }
//   return false;
// };

export const subscriberUser = async (userId) => {
  if (typeof window === "undefined" || !("serviceWorker" in navigator))
    return false;
  try {
    const registration = await navigator.serviceWorker.register("/sw.js");

    // Ensure the service worker is ready before subscribing

    await navigator.serviceWorker.ready;

    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      console.log("Notification permission denied");
      return false;
    }

    // Subscription Logic

    const subscribeOptions = {
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUnit8Array(
        process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
      ),
    };

    // check if subscription already exists to avoid duplicate work

    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe(subscribeOptions);
    } else {
      console.log("Existing subscription found");
    }

    // Send to Server

    const response = await saveSubscription(userId, subscription);
    console.log("Subscription saved response:", response);
    return !!response;
  } catch (error) {
    console.error("Error during subscription process:", error);
    return false;
  }
};
