/**
 * 초과기록 서비스 워커. 진동 알림만 한다.
 *
 * 범위는 /overtime 뿐이다. 순찰일지와 식권 화면에는 걸리지 않는다.
 * 캐시를 두지 않는다(fetch 를 가로채지 않는다). 사진도 화면도 여기에 남지 않는다.
 * 알림 글은 서버가 칸 번호와 날짜로 만든 것만 온다(src/core/overtime/push.ts).
 */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "초과기록", {
      body: data.body || "",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: data.tag || "overtime",
      renotify: true,
      vibrate: [300, 120, 300, 120, 300],
      data: { url: data.url || "/overtime" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/overtime";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((tabs) => {
      for (const tab of tabs) {
        if (tab.url.includes("/overtime") && "focus" in tab) return tab.focus();
      }
      return self.clients.openWindow(url);
    }),
  );
});
