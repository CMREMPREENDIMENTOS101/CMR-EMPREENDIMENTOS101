'use client'

import { useMemo } from 'react'
import { Download } from 'lucide-react'
import type { Locacao, Periodo } from '@/lib/types'
import { PERIODO_LABEL } from '@/lib/types'
import {
  brl, brlCurto, custoIncorrido, custoPrevisto, emAlerta, fmtData, hoje, situacao, valorPorPeriodo,
} from '@/lib/calc'

/** Fator para converter o valor de um período em valor por mês (30 dias) */
const POR_MES: Record<Periodo, number> = { diaria: 30, semanal: 30 / 7, quinzenal: 2, mensal: 1 }

interface Linha { chave: string; ativos: number; mensal: number; incorrido: number; previsto: number }

function agrupar(lista: Locacao[], chave: (l: Locacao) => string, ref: string): Linha[] {
  const m = new Map<string, Linha>()
  for (const l of lista) {
    const k = chave(l) || '— sem informação —'
    const g = m.get(k) ?? { chave: k, ativos: 0, mensal: 0, incorrido: 0, previsto: 0 }
    if (l.status !== 'devolvido') { g.ativos++; g.mensal += valorPorPeriodo(l) * POR_MES[l.periodo] }
    g.incorrido += custoIncorrido(l, ref)
    g.previsto += custoPrevisto(l, ref)
    m.set(k, g)
  }
  return Array.from(m.values()).sort((a, b) => b.incorrido - a.incorrido)
}

function csv(lista: Locacao[], alertaDias: number) {
  const ref = hoje()
  const cab = ['Equipamento', 'Qtd', 'Descrição', 'Fornecedor', 'Telefone', 'Obra', 'Contrato/NF', 'Cobrança', 'Valor unit.', 'Valor/período', 'Frete',
    'Entrada', 'Vencimento', 'Renovações', 'Situação', 'Retirada agendada', 'Devolução', 'Gasto até hoje', 'Total previsto', 'Observações']
  const num = (n: number) => n.toFixed(2).replace('.', ',')
  const esc = (v: string | number) => {
    const s = String(v ?? '')
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const linhas = lista.map(l => [
    l.equipamento, l.quantidade, l.descricao, l.fornecedor, l.contato, l.obra, l.contrato, PERIODO_LABEL[l.periodo],
    num(l.valorUnitario), num(valorPorPeriodo(l)), num(l.frete), fmtData(l.dataEntrada), fmtData(l.dataFim), l.renovacoes.length,
    situacao(l, alertaDias, ref).texto, l.devolucaoPrevista ? fmtData(l.devolucaoPrevista) : '', l.dataDevolucao ? fmtData(l.dataDevolucao) : '',
    num(custoIncorrido(l, ref)), num(custoPrevisto(l, ref)), l.observacoes,
  ].map(esc).join(';'))
  // BOM + ";" para o Excel em pt-BR abrir acentos e colunas certos
  const blob = new Blob(['﻿' + [cab.join(';'), ...linhas].join('\r\n')], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `equipamentos-locados-${ref}.csv`
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}

export default function Resumo({ lista, alertaDias, obra }: { lista: Locacao[]; alertaDias: number; obra: string }) {
  const ref = hoje()
  const d = useMemo(() => {
    const ativos = lista.filter(l => l.status !== 'devolvido')
    return {
      ativos: ativos.length,
      alertas: ativos.filter(l => emAlerta(situacao(l, alertaDias, ref))).length,
      mensal: ativos.reduce((s, l) => s + valorPorPeriodo(l) * POR_MES[l.periodo], 0),
      emAberto: ativos.reduce((s, l) => s + custoPrevisto(l, ref), 0),
      incorrido: lista.reduce((s, l) => s + custoIncorrido(l, ref), 0),
      porObra: agrupar(lista, l => l.obra, ref),
      porFornecedor: agrupar(lista, l => l.fornecedor, ref),
    }
  }, [lista, alertaDias, ref])

  return (
    <div className="space-y-4 page-enter">
      <div className="grid grid-cols-2 gap-2.5">
        <Kpi label="Custo mensal atual" valor={brlCurto(d.mensal)} sub={`${d.ativos} equipamento(s) na obra`} destaque />
        <Kpi label="Gasto acumulado" valor={brlCurto(d.incorrido)} sub="até hoje, inclui devolvidos" />
        <Kpi label="Previsto em aberto" valor={brlCurto(d.emAberto)} sub="contratos ativos até o vencimento" />
        <Kpi label="Em alerta" valor={String(d.alertas)} sub={`vencem em até ${alertaDias} dias`} cor={d.alertas ? 'var(--c-rose)' : undefined} />
      </div>

      {!obra && <Tabela titulo="Por obra" linhas={d.porObra} />}
      <Tabela titulo="Por fornecedor" linhas={d.porFornecedor} />

      <button onClick={() => csv(lista, alertaDias)} disabled={!lista.length}
        className="btn-ghost w-full rounded-xl py-3 text-sm flex items-center justify-center gap-2">
        <Download size={16} /> Exportar planilha (CSV){obra ? ` — ${obra}` : ''}
      </button>
      <p className="text-[11px] text-muted-2 leading-relaxed">
        Regra de cálculo: período iniciado = período cobrado (ex.: 32 dias em locação mensal = 2 meses).
        Atraso após o vencimento entra no previsto. Custo mensal converte diária ×30, semanal ×30/7, quinzenal ×2.
      </p>
    </div>
  )
}

function Kpi({ label, valor, sub, destaque, cor }: { label: string; valor: string; sub: string; destaque?: boolean; cor?: string }) {
  return (
    <div className="glass rounded-2xl px-3.5 py-3" style={destaque ? { borderColor: 'rgb(var(--accent-rgb) / 0.35)' } : undefined}>
      <p className="text-[10px] uppercase tracking-wider font-semibold text-muted">{label}</p>
      <p className="text-[22px] font-bold mt-0.5 tabular-nums" style={{ color: cor ?? (destaque ? 'var(--accent)' : 'var(--color-fg)') }}>{valor}</p>
      <p className="text-[11px] text-muted-2 leading-tight">{sub}</p>
    </div>
  )
}

function Tabela({ titulo, linhas }: { titulo: string; linhas: Linha[] }) {
  if (!linhas.length) return null
  const total = linhas.reduce((s, l) => s + l.incorrido, 0) || 1
  return (
    <section className="glass rounded-2xl p-4">
      <h3 className="text-sm font-bold mb-3">{titulo}</h3>
      <ul className="space-y-3">
        {linhas.map(l => (
          <li key={l.chave}>
            <div className="flex justify-between gap-2 text-sm">
              <span className="font-semibold truncate">{l.chave}</span>
              <span className="font-bold tabular-nums shrink-0">{brl(l.incorrido)}</span>
            </div>
            <div className="h-1.5 rounded-full mt-1.5 overflow-hidden" style={{ background: 'rgb(var(--ink-rgb) / 0.07)' }}>
              <div className="h-full rounded-full" style={{ width: `${(l.incorrido / total) * 100}%`, background: 'var(--accent-gradient)' }} />
            </div>
            <p className="text-[11px] text-muted mt-1">
              {l.ativos} ativo(s) · {brlCurto(l.mensal)}/mês · previsto {brlCurto(l.previsto)}
            </p>
          </li>
        ))}
      </ul>
    </section>
  )
}
