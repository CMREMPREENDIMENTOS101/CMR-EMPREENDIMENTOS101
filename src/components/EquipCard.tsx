'use client'

import { Building2, Camera, HardHat, Pencil } from 'lucide-react'
import type { Locacao } from '@/lib/types'
import { PERIODO_LABEL, PERIODO_UNIDADE } from '@/lib/types'
import { brl, custoPrevisto, fmtCurta, valorPorPeriodo, type Situacao } from '@/lib/calc'

export const NIVEL_COR: Record<Situacao['nivel'], string> = {
  ok: 'var(--c-ok)',
  alerta: 'var(--c-rose)',
  vencido: 'var(--c-rose)',
  agendado: 'var(--c-brown)',
  devolvido: 'var(--color-muted-2)',
}

const SELO: Record<Situacao['nivel'], string> = {
  ok: 'Ativo',
  alerta: '⚠ Alerta',
  vencido: '⛔ Vencido',
  agendado: '📅 Agendado',
  devolvido: '✓ Devolvido',
}

const tint = (cor: string, pct = 12) => `color-mix(in srgb, ${cor} ${pct}%, transparent)`

export function Pill({ children, cor, forte }: { children: React.ReactNode; cor?: string; forte?: boolean }) {
  return (
    <span
      className="pill"
      style={cor
        ? { background: tint(cor, forte ? 16 : 10), color: cor, border: `1px solid ${tint(cor, 28)}` }
        : { background: 'rgb(var(--ink-rgb) / 0.05)', color: 'var(--color-fg)', border: '1px solid var(--color-border)' }}
    >
      {children}
    </span>
  )
}

export default function EquipCard({ l, sit, fotos, onAbrir, onEditar, onRenovar, onDevolver }: {
  l: Locacao
  sit: Situacao
  fotos?: { recebimento: number; entrega: number }
  onAbrir: () => void
  /** Ausente = usuário sem permissão de edição */
  onEditar?: () => void
  onRenovar: () => void
  onDevolver: () => void
}) {
  const cor = NIVEL_COR[sit.nivel]
  const critico = sit.nivel === 'alerta' || sit.nivel === 'vencido'
  const devolvido = l.status === 'devolvido'
  const [un] = PERIODO_UNIDADE[l.periodo]

  return (
    <article
      className="glass rounded-2xl overflow-hidden"
      style={{ borderLeft: `4px solid ${cor}`, opacity: devolvido ? 0.85 : 1 }}
    >
      <div className="p-4 space-y-2.5" onClick={onAbrir} role="button" tabIndex={0}
        onKeyDown={e => { if (e.key === 'Enter') onAbrir() }}>
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-[17px] font-bold text-fg leading-tight">{l.equipamento}</h3>
          {onEditar && (
            <button
              onClick={e => { e.stopPropagation(); onEditar() }}
              aria-label="Editar"
              className="w-8 h-8 -mr-1 -mt-1 shrink-0 rounded-lg flex items-center justify-center text-muted"
            >
              <Pencil size={16} />
            </button>
          )}
        </div>

        <p className="text-[13px] text-muted flex items-center gap-1.5 flex-wrap">
          <Building2 size={14} className="shrink-0" />
          <span>{l.fornecedor || 'Sem fornecedor'} · {PERIODO_LABEL[l.periodo]}</span>
          {l.obra && <><span className="text-muted-2">·</span><HardHat size={14} className="shrink-0" /><span>{l.obra}</span></>}
        </p>

        <div className="flex flex-wrap gap-1.5">
          <Pill>Entrada {fmtCurta(l.dataEntrada)}</Pill>
          {devolvido
            ? <Pill cor="var(--c-ok)">Devolvido {fmtCurta(l.dataDevolucao)}</Pill>
            : <Pill cor={critico ? 'var(--c-rose)' : undefined}>Até {fmtCurta(l.dataFim)}</Pill>}
          {l.status === 'devolucao_agendada' && <Pill cor="var(--c-brown)">Retirada {fmtCurta(l.devolucaoPrevista)}</Pill>}
        </div>

        <div className="flex items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1.5">
            {!devolvido && <Pill cor={critico ? 'var(--c-rose)' : 'var(--c-ok)'}>{sit.texto}</Pill>}
            {l.renovacoes.length > 0 && <Pill cor="var(--c-sky)">🔄 {l.renovacoes.length}x renovado</Pill>}
          </div>
          <Pill cor={cor} forte>{SELO[sit.nivel].toUpperCase()}</Pill>
        </div>

        {l.descricao && (
          <p className="text-[13px] text-muted rounded-xl px-3 py-2" style={{ background: 'rgb(var(--ink-rgb) / 0.04)' }}>
            {l.quantidade > 1 && <b className="text-fg">{l.quantidade} un · </b>}{l.descricao}
          </p>
        )}

        <div className="flex items-end justify-between gap-2 pt-0.5">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-muted-2 font-semibold">{brl(valorPorPeriodo(l))} / {un}</p>
            <p className="text-[15px] font-bold text-fg">{brl(custoPrevisto(l))} <span className="text-[11px] font-medium text-muted">{devolvido ? 'total' : 'previsto'}</span></p>
          </div>
          {fotos && (
            <p className="text-[11px] text-muted flex items-center gap-1">
              <Camera size={13} /> {fotos.recebimento} receb. · {fotos.entrega} entrega
            </p>
          )}
        </div>
      </div>

      {!devolvido && (
        <div className="grid grid-cols-2 gap-2 px-4 pb-4">
          <button onClick={onRenovar} className="btn-accent rounded-xl py-3 text-sm">🔄 Renovar</button>
          <button onClick={onDevolver} className="btn-ghost rounded-xl py-3 text-sm">📦 Devolver</button>
        </div>
      )}
    </article>
  )
}
