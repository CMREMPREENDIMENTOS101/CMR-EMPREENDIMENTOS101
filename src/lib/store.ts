import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Foto, Locacao, TipoFoto } from './types'
import { uid } from './calc'
import { comprimirImagem } from './image'

/**
 * Persistência com duas implementações de mesma interface:
 *  - local: IndexedDB no aparelho (funciona sem servidor e offline; não compartilha entre aparelhos)
 *  - supabase: tabelas equip_locacoes / equip_fotos + bucket privado equip-fotos (ver supabase/schema.sql)
 * O modo é escolhido pelas variáveis NEXT_PUBLIC_SUPABASE_*.
 */
export interface Store {
  modo: 'local' | 'supabase'
  listar(): Promise<Locacao[]>
  salvar(l: Locacao): Promise<void>
  excluir(id: string): Promise<void>
  listarFotos(locacaoId: string): Promise<Foto[]>
  contarFotos(): Promise<Record<string, { recebimento: number; entrega: number }>>
  adicionarFoto(locacaoId: string, tipo: TipoFoto, arquivo: Blob): Promise<Foto>
  excluirFoto(f: Foto): Promise<void>
  /** URL exibível. No modo local é um blob: — quem chama deve revogar com URL.revokeObjectURL */
  urlFoto(f: Foto): Promise<string>
}

// ─── Local (IndexedDB) ─────────────────────────────────────────
const DB = 'cmr-equipamentos'
const DB_VER = 1

function abrir(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB, DB_VER)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('locacoes')) db.createObjectStore('locacoes', { keyPath: 'id' })
      if (!db.objectStoreNames.contains('fotos')) {
        const fotos = db.createObjectStore('fotos', { keyPath: 'id' })
        fotos.createIndex('locacaoId', 'locacaoId')
        fotos.createIndex('locacaoTipo', ['locacaoId', 'tipo'])
      }
    }
    req.onsuccess = () => res(req.result)
    req.onerror = () => rej(req.error)
  })
}

function tx<T>(stores: string[], mode: IDBTransactionMode, fn: (t: IDBTransaction) => IDBRequest<T> | void): Promise<T> {
  return abrir().then(db => new Promise<T>((res, rej) => {
    const t = db.transaction(stores, mode)
    const r = fn(t)
    t.oncomplete = () => res(r ? r.result : (undefined as T))
    t.onerror = () => rej(t.error)
    t.onabort = () => rej(t.error ?? new Error('Transação abortada (armazenamento cheio?)'))
  }))
}

const localStore: Store = {
  modo: 'local',
  listar: () => tx<Locacao[]>(['locacoes'], 'readonly', t => t.objectStore('locacoes').getAll()),
  salvar: l => tx(['locacoes'], 'readwrite', t => { t.objectStore('locacoes').put(l) }),
  excluir: id => tx(['locacoes', 'fotos'], 'readwrite', t => {
    t.objectStore('locacoes').delete(id)
    const idx = t.objectStore('fotos').index('locacaoId')
    idx.openKeyCursor(IDBKeyRange.only(id)).onsuccess = e => {
      const c = (e.target as IDBRequest<IDBCursor | null>).result
      if (c) { t.objectStore('fotos').delete(c.primaryKey); c.continue() }
    }
  }),
  listarFotos: id => tx<Foto[]>(['fotos'], 'readonly', t => t.objectStore('fotos').index('locacaoId').getAll(IDBKeyRange.only(id)))
    .then(fs => fs.sort((a, b) => a.criadoEm.localeCompare(b.criadoEm))),
  contarFotos: async () => {
    // Cursor de chaves do índice [locacaoId, tipo]: não carrega os blobs na memória
    const out: Record<string, { recebimento: number; entrega: number }> = {}
    await tx(['fotos'], 'readonly', t => {
      t.objectStore('fotos').index('locacaoTipo').openKeyCursor().onsuccess = e => {
        const c = (e.target as IDBRequest<IDBCursor | null>).result
        if (!c) return
        const [locacaoId, tipo] = c.key as [string, TipoFoto]
        ;(out[locacaoId] ??= { recebimento: 0, entrega: 0 })[tipo]++
        c.continue()
      }
    })
    return out
  },
  adicionarFoto: async (locacaoId, tipo, arquivo) => {
    const blob = await comprimirImagem(arquivo)
    const f: Foto = { id: uid(), locacaoId, tipo, criadoEm: new Date().toISOString(), blob }
    await tx(['fotos'], 'readwrite', t => { t.objectStore('fotos').put(f) })
    return f
  },
  excluirFoto: f => tx(['fotos'], 'readwrite', t => { t.objectStore('fotos').delete(f.id) }),
  urlFoto: async f => (f.blob ? URL.createObjectURL(f.blob) : ''),
}

// ─── Supabase ─────────────────────────────────────────────────
const BUCKET = 'equip-fotos'

type Row = Record<string, unknown>

const toRow = (l: Locacao): Row => ({
  id: l.id,
  equipamento: l.equipamento,
  descricao: l.descricao,
  quantidade: l.quantidade,
  fornecedor: l.fornecedor,
  contato: l.contato,
  obra: l.obra,
  contrato: l.contrato,
  periodo: l.periodo,
  valor_unitario: l.valorUnitario,
  frete: l.frete,
  data_entrada: l.dataEntrada,
  data_fim: l.dataFim,
  renovacoes: l.renovacoes,
  status: l.status,
  devolucao_prevista: l.devolucaoPrevista,
  data_devolucao: l.dataDevolucao,
  observacoes: l.observacoes,
  criado_em: l.criadoEm,
  atualizado_em: l.atualizadoEm,
})

const fromRow = (r: Row): Locacao => ({
  id: String(r.id),
  equipamento: String(r.equipamento ?? ''),
  descricao: String(r.descricao ?? ''),
  quantidade: Number(r.quantidade ?? 1),
  fornecedor: String(r.fornecedor ?? ''),
  contato: String(r.contato ?? ''),
  obra: String(r.obra ?? ''),
  contrato: String(r.contrato ?? ''),
  periodo: (r.periodo as Locacao['periodo']) ?? 'mensal',
  valorUnitario: Number(r.valor_unitario ?? 0),
  frete: Number(r.frete ?? 0),
  dataEntrada: String(r.data_entrada),
  dataFim: String(r.data_fim),
  renovacoes: Array.isArray(r.renovacoes) ? (r.renovacoes as Locacao['renovacoes']) : [],
  status: (r.status as Locacao['status']) ?? 'ativo',
  devolucaoPrevista: (r.devolucao_prevista as string | null) ?? null,
  dataDevolucao: (r.data_devolucao as string | null) ?? null,
  observacoes: String(r.observacoes ?? ''),
  criadoEm: String(r.criado_em ?? ''),
  atualizadoEm: String(r.atualizado_em ?? ''),
})

const fotoFromRow = (r: Row): Foto => ({
  id: String(r.id), locacaoId: String(r.locacao_id), tipo: r.tipo as TipoFoto,
  criadoEm: String(r.criado_em), path: String(r.path),
})

function erro(e: { message: string } | null) {
  if (e) throw new Error(e.message)
}

function supabaseStore(sb: SupabaseClient): Store {
  return {
    modo: 'supabase',
    async listar() {
      const { data, error } = await sb.from('equip_locacoes').select('*').order('data_fim')
      erro(error)
      return (data ?? []).map(fromRow)
    },
    async salvar(l) {
      const { error } = await sb.from('equip_locacoes').upsert(toRow(l))
      erro(error)
    },
    async excluir(id) {
      const { data } = await sb.from('equip_fotos').select('path').eq('locacao_id', id)
      const paths = (data ?? []).map(r => String(r.path))
      if (paths.length) await sb.storage.from(BUCKET).remove(paths)
      const { error } = await sb.from('equip_locacoes').delete().eq('id', id) // equip_fotos: on delete cascade
      erro(error)
    },
    async listarFotos(id) {
      const { data, error } = await sb.from('equip_fotos').select('*').eq('locacao_id', id).order('criado_em')
      erro(error)
      return (data ?? []).map(fotoFromRow)
    },
    async contarFotos() {
      const { data, error } = await sb.from('equip_fotos').select('locacao_id,tipo')
      erro(error)
      const out: Record<string, { recebimento: number; entrega: number }> = {}
      for (const r of data ?? []) (out[String(r.locacao_id)] ??= { recebimento: 0, entrega: 0 })[r.tipo as TipoFoto]++
      return out
    },
    async adicionarFoto(locacaoId, tipo, arquivo) {
      const blob = await comprimirImagem(arquivo)
      const id = uid()
      const path = `${locacaoId}/${tipo}/${id}.jpg`
      const up = await sb.storage.from(BUCKET).upload(path, blob, { contentType: blob.type || 'image/jpeg' })
      erro(up.error)
      const { data, error } = await sb.from('equip_fotos')
        .insert({ id, locacao_id: locacaoId, tipo, path }).select().single()
      if (error) { await sb.storage.from(BUCKET).remove([path]); erro(error) }
      return fotoFromRow(data as Row)
    },
    async excluirFoto(f) {
      if (f.path) await sb.storage.from(BUCKET).remove([f.path])
      const { error } = await sb.from('equip_fotos').delete().eq('id', f.id)
      erro(error)
    },
    async urlFoto(f) {
      if (!f.path) return ''
      const { data } = await sb.storage.from(BUCKET).createSignedUrl(f.path, 3600)
      return data?.signedUrl ?? ''
    },
  }
}

// ─── Seleção ──────────────────────────────────────────────────
let sbClient: SupabaseClient | null = null

export function supabase(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) return null
  sbClient ??= createClient(url, key)
  return sbClient
}

export function getStore(): Store {
  const sb = supabase()
  return sb ? supabaseStore(sb) : localStore
}
