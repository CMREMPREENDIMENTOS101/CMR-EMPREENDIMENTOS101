// Service worker do app de celular "Locações CMR".
// Escopo '/locacoes' — igual ao Efetivo, para NÃO tocar no Sistema RH (/index.html).
const CACHE = 'locacoes-v1';
const ARQUIVOS = [
  '/locacoes.html',
  '/locacoes.webmanifest',
  '/locacoes-icon-192.png',
  '/locacoes-icon-512.png',
  '/locacoes-icon-180.png',
  '/cmr-logo.png'
];

self.addEventListener('install', ev => {
  ev.waitUntil(caches.open(CACHE).then(c => c.addAll(ARQUIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', ev => {
  ev.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k.startsWith('locacoes-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Só GET do próprio site. /api/* nunca é cacheado (fotos incluídas: o navegador já
// guarda pelo Cache-Control). Sem sinal, quem segura as alterações é a fila do app.
self.addEventListener('fetch', ev => {
  const req = ev.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  ev.respondWith(
    fetch(req)
      .then(resp => {
        if (resp && resp.ok) {
          const copia = resp.clone();
          caches.open(CACHE).then(c => c.put(req, copia)).catch(() => {});
        }
        return resp;
      })
      .catch(() => caches.match(req).then(r => r || caches.match('/locacoes.html')))
  );
});

self.addEventListener('notificationclick', ev => {
  ev.notification.close();
  ev.waitUntil(self.clients.matchAll({ type: 'window' }).then(cs => cs[0] ? cs[0].focus() : self.clients.openWindow('/locacoes.html')));
});
