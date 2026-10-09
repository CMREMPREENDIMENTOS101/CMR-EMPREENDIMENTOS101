export type Periodo = 'diaria' | 'semanal' | 'quinzenal' | 'mensal'
export type Status = 'ativo' | 'devolucao_agendada' | 'devolvido'
export type TipoFoto = 'recebimento' | 'entrega'

export interface Renovacao {
  /** Data (yyyy-mm-dd) em que a renovação foi registrada */
  em: string
  fimAnterior: string
  novoFim: string
}

export interface Locacao {
  id: string
  equipamento: string
  descricao: string
  quantidade: number
  fornecedor: string
  contato: string
  obra: string
  contrato: string
  periodo: Periodo
  /** Valor de UMA unidade por período (R$) */
  valorUnitario: number
  /** Frete de ida + volta, taxa de limpeza etc. — cobrados uma vez */
  frete: number
  dataEntrada: string
  /** Vencimento atual do contrato (já considera renovações) */
  dataFim: string
  renovacoes: Renovacao[]
  status: Status
  /** Data agendada para a retirada pela locadora */
  devolucaoPrevista: string | null
  /** Data em que o equipamento saiu da obra */
  dataDevolucao: string | null
  observacoes: string
  criadoEm: string
  atualizadoEm: string
}

export interface Foto {
  id: string
  locacaoId: string
  tipo: TipoFoto
  criadoEm: string
  /** Caminho no Storage (modo Supabase) */
  path?: string
  /** Imagem (modo local) */
  blob?: Blob
}

export const PERIODO_LABEL: Record<Periodo, string> = {
  diaria: 'Diária',
  semanal: 'Semanal',
  quinzenal: 'Quinzenal',
  mensal: 'Mensal',
}

export const PERIODO_UNIDADE: Record<Periodo, [string, string]> = {
  diaria: ['diária', 'diárias'],
  semanal: ['semana', 'semanas'],
  quinzenal: ['quinzena', 'quinzenas'],
  mensal: ['mês', 'meses'],
}
