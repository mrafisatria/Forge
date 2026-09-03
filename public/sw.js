/* Forge only: no offline caching of pages, credentials, routines, or private media. */
self.addEventListener('install', (event) => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  event.waitUntil((async () => {
    let data;
    try { data = event.data?.json(); } catch { return; }
    if (data?.type !== 'forge-rest-timer' || !/^[0-9a-f-]{36}$/i.test(data.id ?? '')) return;
    // Always display a user-visible notification for Web Push (required by iOS).
    // Never start audio, even if the page is suspended or another app is playing.
    await self.registration.showNotification('Waktu istirahat selesai', {
      body: 'Siap untuk set berikutnya? Buka Forge untuk melanjutkan.',
      icon: '/apple-icon.png', badge: '/favicon.svg',
      tag: `forge-timer-${data.id}`, renotify: false, silent: true,
      data: { timerId: data.id },
    });
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) client.postMessage({ type: 'forge-timer-delivered', id: data.id });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find((client) => new URL(client.url).origin === self.location.origin);
    if (existing) return existing.focus();
    return self.clients.openWindow('/');
  })());
});
