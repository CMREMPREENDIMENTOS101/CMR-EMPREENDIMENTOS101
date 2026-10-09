'use client'

import { useCallback, useEffect, useState } from 'react'

export interface Prefs {
  alertaDias: number
  tema: 'light' | 'dark'
  notificar: boolean
}

const KEY = 'cmr-equip-prefs'
const PADRAO: Prefs = { alertaDias: 5, tema: 'light', notificar: false }

function ler(): Prefs {
  try { return { ...PADRAO, ...JSON.parse(localStorage.getItem(KEY) || '{}') } } catch { return PADRAO }
}

export function usePrefs() {
  const [prefs, setPrefs] = useState<Prefs>(PADRAO)
  useEffect(() => { setPrefs(ler()) }, [])
  useEffect(() => { document.documentElement.dataset.theme = prefs.tema }, [prefs.tema])
  const update = useCallback((p: Partial<Prefs>) => {
    setPrefs(prev => {
      const next = { ...prev, ...p }
      try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* modo privado */ }
      return next
    })
  }, [])
  return [prefs, update] as const
}

/**
 * Notificação local, no máximo 1 por dia, quando o app é aberto com equipamentos em alerta.
 * Não é push: com o app fechado nada dispara (isso exigiria servidor + Web Push).
 */
export async function notificarAlertas(qtd: number, nomes: string[]) {
  if (!qtd || typeof Notification === 'undefined' || Notification.permission !== 'granted') return
  const marca = 'cmr-equip-notif-' + new Date().toDateString()
  try { if (localStorage.getItem(marca)) return; localStorage.setItem(marca, '1') } catch { /* ignore */ }
  const titulo = `${qtd} equipamento(s) para devolver ou renovar`
  const corpo = nomes.slice(0, 4).join(', ') + (nomes.length > 4 ? '…' : '')
  const reg = await navigator.serviceWorker?.getRegistration()
  if (reg) reg.showNotification(titulo, { body: corpo, icon: '/icons/icon-192.png', badge: '/icons/favicon-32.png', tag: 'alertas' })
  else new Notification(titulo, { body: corpo, icon: '/icons/icon-192.png' })
}
