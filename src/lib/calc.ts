import type { Locacao, Periodo } from './types'

const MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const DIA_MS = 86400000

/** yyyy-mm-dd no fuso local (toISOString usaria UTC e viraria o dia às 21h no Brasil) */
export function isoLocal(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export const hoje = () => isoLocal(new Date())

function parse(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** Diferença em dias corridos (b − a), imune a horário de verão */
export function diffDias(a: string, b: string): number {
  const da = parse(a), db = parse(b)
  return Math.round((Date.UTC(db.getFullYear(), db.getMonth(), db.getDate()) - Date.UTC(da.getFullYear(), da.getMonth(), da.getDate())) / DIA_MS)
}

export function addDias(s: string, n: number): string {
  const d = parse(s); d.setDate(d.getDate() + n); return isoLocal(d)
}

/** Soma meses mantendo o dia; 31/01 + 1 mês = 28/02 (ou 29), não 03/03 */
export function addMeses(s: string, n: number): string {
  const d = parse(s)
  const dia = d.getDate()
  d.setDate(1); d.setMonth(d.getMonth() + n)
  const ultimo = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
  d.setDate(Math.min(dia, ultimo))
  return isoLocal(d)
}

export function addPeriodo(s: string, p: Periodo, n = 1): string {
  switch (p) {
    case 'diaria': return addDias(s, n)
    case 'semanal': return addDias(s, 7 * n)
    case 'quinzenal': return addDias(s, 15 * n)
    case 'mensal': return addMeses(s, n)
  }
}

/** Dias de cada período para o pró-rata (mês comercial de 30 dias) */
export const DIAS_PERIODO: Record<Periodo, number> = { diaria: 1, semanal: 7, quinzenal: 15, mensal: 30 }

export const valorPorPeriodo = (l: Locacao) => (l.valorUnitario || 0) * (l.quantidade || 1)

/** Valor de um dia de locação de todas as unidades: valor do período ÷ dias do período */
export const valorDia = (l: Locacao) => valorPorPeriodo(l) / DIAS_PERIODO[l.periodo]

/** Dias cobrados entre início e fim (dias corridos, mínimo 1). Sem período mínimo de contrato. */
export const diasCobrados = (inicio: string, fim: string) => Math.max(1, diffDias(inicio, fim))

const centavos = (n: number) => Math.round(n * 100) / 100

/** Custo proporcional do intervalo, sem frete */
export const custoIntervalo = (l: Locacao, inicio: string, fim: string) =>
  centavos(diasCobrados(inicio, fim) * valorDia(l))

const maxData = (...ds: string[]) => ds.reduce((a, b) => (diffDias(a, b) > 0 ? b : a))

/**
 * Fim usado na cobrança: a devolução real; senão o maior entre vencimento, retirada
 * agendada e hoje (atraso também é cobrado).
 */
export function fimCobranca(l: Locacao, ref = hoje()): string {
  if (l.status === 'devolvido' && l.dataDevolucao) return l.dataDevolucao
  return maxData(l.dataFim, ref, ...(l.devolucaoPrevista ? [l.devolucaoPrevista] : []))
}

/** Custo total previsto (até o vencimento, ou até hoje se atrasado, ou até a devolução real) */
export function custoPrevisto(l: Locacao, ref = hoje()): number {
  return custoIntervalo(l, l.dataEntrada, fimCobranca(l, ref)) + (l.frete || 0)
}

/** Custo já incorrido até a data de referência */
export function custoIncorrido(l: Locacao, ref = hoje()): number {
  const fim = l.status === 'devolvido' && l.dataDevolucao ? l.dataDevolucao : ref
  if (diffDias(l.dataEntrada, fim) < 0) return 0
  return custoIntervalo(l, l.dataEntrada, fim) + (l.frete || 0)
}

export type Nivel = 'ok' | 'alerta' | 'vencido' | 'devolvido' | 'agendado'

export interface Situacao {
  nivel: Nivel
  dias: number | null
  texto: string
}

export function situacao(l: Locacao, alertaDias: number, ref = hoje()): Situacao {
  if (l.status === 'devolvido') return { nivel: 'devolvido', dias: null, texto: 'Devolvido' }
  if (l.status === 'devolucao_agendada' && l.devolucaoPrevista) {
    const d = diffDias(ref, l.devolucaoPrevista)
    if (d < 0) return { nivel: 'vencido', dias: d, texto: `Retirada atrasada ${-d}d` }
    if (d === 0) return { nivel: 'alerta', dias: 0, texto: 'Retirada hoje' }
    return { nivel: 'agendado', dias: d, texto: `Retirada em ${d}d` }
  }
  const d = diffDias(ref, l.dataFim)
  if (d < 0) return { nivel: 'vencido', dias: d, texto: `Vencido há ${-d}d` }
  if (d === 0) return { nivel: 'alerta', dias: 0, texto: 'Vence hoje' }
  if (d <= alertaDias) return { nivel: 'alerta', dias: d, texto: `${d}d restantes` }
  return { nivel: 'ok', dias: d, texto: `${d}d restantes` }
}

export const emAlerta = (s: Situacao) => s.nivel === 'alerta' || s.nivel === 'vencido'

export function fmtCurta(s?: string | null): string {
  if (!s) return '—'
  const d = parse(s)
  return `${String(d.getDate()).padStart(2, '0')} de ${MES[d.getMonth()]}`
}

export function fmtData(s?: string | null): string {
  if (!s) return '—'
  const d = parse(s)
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
}

export function fmtLonga(s?: string | null): string {
  if (!s) return '—'
  const d = parse(s)
  return `${d.getDate()} de ${MES[d.getMonth()]}. de ${d.getFullYear()}`
}

export const brl = (n: number) =>
  (n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export const brlCurto = (n: number) =>
  'R$ ' + (n || 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 })

/** "1.234,56" / "1234.56" / "1234,5" → número */
export function parseValor(s: string): number {
  const t = s.replace(/[^\d,.-]/g, '')
  if (!t) return 0
  const norm = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t
  const n = Number(norm)
  return Number.isFinite(n) ? n : 0
}

export function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}
