'use client'

import { supabase } from './store'

/**
 * Web Push: o aparelho se inscreve aqui; o aviso diário sai de /api/cron/alertas (Vercel Cron),
 * então chega mesmo com o app fechado. Exige modo Supabase e as chaves VAPID.
 */
const VAPID = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY

export function pushDisponivel(): boolean {
  return !!(supabase() && VAPID && typeof window !== 'undefined'
    && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window)
}

function chave(base64: string): ArrayBuffer {
  const pad = '='.repeat((4 - (base64.length % 4)) % 4)
  const raw = atob((base64 + pad).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(raw, c => c.charCodeAt(0)).buffer as ArrayBuffer
}

async function registro() {
  await navigator.serviceWorker.register('/sw.js')
  return navigator.serviceWorker.ready
}

export async function ativarPush(alertaDias: number): Promise<void> {
  const sb = supabase()
  if (!sb || !VAPID) throw new Error('Push não configurado no servidor.')
  if ((await Notification.requestPermission()) !== 'granted') {
    throw new Error('Permissão negada. Libere as notificações nas configurações do celular.')
  }
  const reg = await registro()
  const sub = (await reg.pushManager.getSubscription())
    ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: chave(VAPID) }))
  const j = sub.toJSON()
  const { data: { user } } = await sb.auth.getUser()
  if (!user?.email || !j.endpoint || !j.keys) throw new Error('Sessão expirada. Entre de novo.')
  const { error } = await sb.from('equip_push_subs').upsert({
    endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth,
    email: user.email.toLowerCase(), alerta_dias: alertaDias,
  })
  if (error) throw new Error(error.message)
}

export async function desativarPush(): Promise<void> {
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = await reg?.pushManager.getSubscription()
  if (!sub) return
  await supabase()?.from('equip_push_subs').delete().eq('endpoint', sub.endpoint)
  await sub.unsubscribe()
}

export async function atualizarDiasPush(alertaDias: number): Promise<void> {
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = await reg?.pushManager.getSubscription()
  if (sub) await supabase()?.from('equip_push_subs').update({ alerta_dias: alertaDias }).eq('endpoint', sub.endpoint)
}
