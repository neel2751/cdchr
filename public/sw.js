self.addEventListener("push", (event) => {
  let data = {};

  try {
    // Try to parse as JSON first
    data = event.data.json();
  } catch (e) {
    // If it's not JSON (like your "Test push" string), use it as the body
    data = {
      title: "Attendance Alert",
      body: event.data.text(),
      url: "/",
    };
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
