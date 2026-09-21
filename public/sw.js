/* DS Studio service worker — installability + generation notifications. */

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  const fallback = {
    title: "DS Studio",
    body: "A generation finished.",
    tag: "ds-studio",
    url: "/",
  };
  let payload = fallback;
  try {
    if (event.data) {
      const parsed = event.data.json();
      if (parsed && typeof parsed === "object") {
        payload = { ...fallback, ...parsed };
      }
    }
  } catch {
    try {
      const text = event.data?.text();
      if (text) payload = { ...fallback, body: text };
    } catch {
      /* keep fallback */
    }
  }

  event.waitUntil(
    self.registration.showNotification(String(payload.title || fallback.title), {
      body: String(payload.body || fallback.body),
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: String(payload.tag || fallback.tag),
      renotify: true,
      data: { url: String(payload.url || "/") },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification.data?.url || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) {
          if ("navigate" in client && typeof client.navigate === "function") {
            return client.navigate(target).then((next) => next ?? client.focus());
          }
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
