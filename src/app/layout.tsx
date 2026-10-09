import type { Metadata, Viewport } from 'next'
import './globals.css'
import SWRegister from '@/components/SWRegister'

export const metadata: Metadata = {
  title: 'Equipamentos · CMR',
  description: 'Controle de equipamentos locados em obra: vencimentos, alertas, custos e fotos.',
  manifest: '/manifest.json',
  appleWebApp: { capable: true, title: 'Equipamentos', statusBarStyle: 'default' },
  icons: {
    icon: [{ url: '/icons/favicon-32.png', sizes: '32x32' }, { url: '/icons/favicon-192.png', sizes: '192x192' }],
    apple: '/icons/apple-touch-icon.png',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#F2F2F4',
}

// Aplica o tema salvo antes da pintura (evita piscar claro→escuro)
const temaInicial = `try{var p=JSON.parse(localStorage.getItem('cmr-equip-prefs')||'{}');document.documentElement.dataset.theme=p.tema||'light'}catch(e){}`

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" data-theme="light" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: temaInicial }} />
      </head>
      <body>
        {children}
        <SWRegister />
      </body>
    </html>
  )
}
