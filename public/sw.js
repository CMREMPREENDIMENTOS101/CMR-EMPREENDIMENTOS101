// App shell offline: HTML com network-first, assets estáticos com cache-first.
// Dados ficam no IndexedDB (modo local) ou vêm do Supabase (não cacheado aqui).
const CACHE = 'cmr-equip-v1'
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

self.addEventListener('notificationclick', e => {
  e.notification.close()
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const aberto = list.find(c => 'focus' in c)
      return aberto ? aberto.focus() : self.clients.openWindow('/')
    })
  )
})
