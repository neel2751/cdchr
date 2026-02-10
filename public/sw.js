self.addEventListener("push", (event) => {
  let payload = { title: "New Notification", body: "Check your dashboard" };

  if (event.data) {
    try {
      payload = event.data.json();
    } catch (e) {
      payload.body = event.data.text();
    }
  }

  const options = {
    body: data.body || "You have a new reminder",
    icon: "https://res.cloudinary.com/drcjzx0sw/image/upload/v1769877067/192_b6yksa.png",
    badge:
      "https://res.cloudinary.com/drcjzx0sw/image/upload/v1769877067/72_outdki.png",
    vibrate: [100, 50, 100],
    data: { url: data.url || "/" },
  };

  event.waitUntil(
    self.registration.showNotification(data.title || "Reminder", options)
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow(event.notification.data.url));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const notificationData = event.notification.data;
  event.waitUntil(
    clients.matchAll({ type: "window" }).then((clientList) => {
      for (const client of clientList) {
        if (client.url === notificationData.url && "focus" in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(notificationData.url);
      }
    })
  );
});
