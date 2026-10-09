// App shell offline: HTML com network-first, assets estáticos com cache-first.
// Dados ficam no IndexedDB (modo local) ou vêm do Supabase (não cacheado aqui).
const CACHE = 'cmr-equip-v2'
const SHELL = ['/', '/manifest.json', '/icons/icon-192.png']

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL).catch(() => {})).then(() => self.skipWaiting()))
})

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', e => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return

  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then(res => {
          if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put('/', copy)) }
          return res
        })
        .catch(() => caches.match('/'))
    )
    return
  }

  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/')) {
    e.respondWith(
      caches.match(req).then(hit => hit || fetch(req).then(res => {
        if (!res.ok) return res
        const copy = res.clone()
        caches.open(CACHE).then(c => c.put(req, copy))
        return res
      }))
    )
  }
})

// Push diário vindo de /api/cron/alertas
self.addEventListener('push', e => {
  let d = {}
  try { d = e.data ? e.data.json() : {} } catch { d = { body: e.data && e.data.text() } }
  e.waitUntil(self.registration.showNotification(d.title || 'Equipamentos', {
    body: d.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/favicon-32.png',
    tag: 'alertas',
    renotify: true,
    data: { url: d.url || '/?filtro=alertas' },
  }))
})

self.addEventListener('notificationclick', e => {
  e.notification.close()
  const url = (e.notification.data && e.notification.data.url) || '/?filtro=alertas'
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const aberto = list.find(c => 'focus' in c)
      if (aberto) { aberto.navigate(url).catch(() => {}); return aberto.focus() }
      return self.clients.openWindow(url)
    })
  )
})
