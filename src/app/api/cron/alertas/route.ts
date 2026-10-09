import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import webpush from 'web-push'
import { fromRow } from '@/lib/store'
import { emAlerta, situacao } from '@/lib/calc'

export const dynamic = 'force-dynamic'

/**
 * Disparado 1x por dia pelo Vercel Cron (vercel.json). Para cada aparelho inscrito, manda
 * um push com o que vence dentro da janela de alerta daquele usuário ou já venceu.
 * A Vercel envia "Authorization: Bearer $CRON_SECRET" automaticamente.
 */
export async function GET(req: Request) {
  const segredo = process.env.CRON_SECRET
  if (!segredo || req.headers.get('authorization') !== `Bearer ${segredo}`) {
    return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 })
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const priv = process.env.VAPID_PRIVATE_KEY
  if (!url || !service || !pub || !priv) {
    return NextResponse.json({ error: 'Variáveis de ambiente do push ausentes.' }, { status: 500 })
  }

  // Contato exigido pelo padrão VAPID; sem VAPID_SUBJECT usa a URL de produção da Vercel
  const subject = process.env.VAPID_SUBJECT || `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL ?? 'localhost'}`
  webpush.setVapidDetails(subject, pub, priv)
  const sb = createClient(url, service, { auth: { persistSession: false } })

  const [locs, subs] = await Promise.all([
    sb.from('equip_locacoes').select('*').neq('status', 'devolvido'),
    sb.from('equip_push_subs').select('*'),
  ])
  if (locs.error || subs.error) {
    return NextResponse.json({ error: (locs.error ?? subs.error)!.message }, { status: 500 })
  }

  // "Hoje" no fuso da obra, não em UTC do servidor
  const ref = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())
  const ativas = (locs.data ?? []).map(fromRow)

  let enviados = 0
  const removidos: string[] = []
  for (const s of subs.data ?? []) {
    const alertas = ativas
      .map(l => ({ l, sit: situacao(l, s.alerta_dias, ref) }))
      .filter(x => emAlerta(x.sit))
      .sort((a, b) => (a.sit.dias ?? 0) - (b.sit.dias ?? 0))
    if (!alertas.length) continue

    const vencidos = alertas.filter(x => x.sit.nivel === 'vencido').length
    const title = vencidos
      ? `⛔ ${vencidos} vencido(s) · ${alertas.length} equipamento(s) em alerta`
      : `⚠ ${alertas.length} equipamento(s) vencendo`
    const body = alertas.slice(0, 5)
      .map(x => `${x.l.equipamento}${x.l.obra ? ` (${x.l.obra})` : ''}: ${x.sit.texto}`)
      .join('\n') + (alertas.length > 5 ? `\n+${alertas.length - 5} outros` : '')

    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify({ title, body, url: '/?filtro=alertas' }),
        { TTL: 60 * 60 * 12 },
      )
      enviados++
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode
      // 404/410 = inscrição expirada ou app desinstalado
      if (status === 404 || status === 410) removidos.push(s.endpoint)
    }
  }
  if (removidos.length) await sb.from('equip_push_subs').delete().in('endpoint', removidos)

  return NextResponse.json({ ref, inscritos: subs.data?.length ?? 0, enviados, removidos: removidos.length })
}
