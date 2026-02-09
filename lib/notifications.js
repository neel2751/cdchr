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

export const subscriberUser = async (userId) => {
  if ("serviceWorker" in navigator) {
    const registration = await navigator.serviceWorker.register("/sw.js");
    const permission = await Notification.requestPermission();

    if (permission === "granted") {
      const subscribeOptions = {
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUnit8Array(
          process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
        ),
      };
      const subscription = await registration.pushManager.subscribe(
        subscribeOptions
      );

      const response = await saveSubscription(userId, subscription);
      console.log("Subscription saved response:", response);
      if (response) return true;
    }
  }
  return false;
};
