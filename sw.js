/* Service Worker ของระบบดูแลครุภัณฑ์และเครื่องมือวิทยาศาสตร์ PSU:LASC
   - แคช HTML ไว้เพื่อใช้งานออฟไลน์ แต่พยายามโหลดของใหม่จากเน็ตก่อนเสมอ
   - ข้อมูลจาก Firebase ไม่แคช (network-first เท่านั้น ไม่ fallback เป็นข้อมูลเก่า) */
const CACHE = 'psu-lasc-maintenance-v1';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './logo-lasc.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (e) => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  /* ข้อมูลจาก Firebase ต้องสดเสมอ ไม่แคช */
  if (url.hostname.indexOf('firebasedatabase.app') >= 0 ||
      url.hostname.indexOf('googleapis.com') >= 0 ||
      url.hostname.indexOf('gstatic.com') >= 0 ||
      url.hostname.indexOf('script.google.com') >= 0) return;

  const isHTML = e.request.mode === 'navigate' ||
    (e.request.headers.get('accept') || '').includes('text/html');

  e.respondWith(
    fetch(isHTML ? new Request(e.request.url, { cache: 'reload' }) : e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() =>
        caches.match(e.request).then((res) => {
          if (res) return res;
          if (isHTML) return caches.match('./index.html');
          return Response.error();
        })
      )
  );
});
