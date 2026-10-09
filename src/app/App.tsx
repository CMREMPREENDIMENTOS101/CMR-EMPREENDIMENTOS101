'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { BarChart3, HardHat, Loader2, Package, Plus, Search, Settings } from 'lucide-react'
import EquipCard from '@/components/EquipCard'
import { DetalheModal, DevolverModal, FormModal, RenovarModal } from '@/components/Modais'
import Resumo from '@/components/Resumo'
import Ajustes from '@/components/Ajustes'
import Login from '@/components/Login'
import { getStore, supabase } from '@/lib/store'
import { emAlerta, hoje, situacao, diffDias } from '@/lib/calc'
import { notificarAlertas, usePrefs } from '@/lib/prefs'
import type { Locacao } from '@/lib/types'

type Aba = 'lista' | 'resumo' | 'ajustes'
type Filtro = 'ativos' | 'alertas' | 'devolvidos' | 'todos'
type ModalState =
  | { tipo: 'novo' }
  | { tipo: 'editar'; id: string }
  | { tipo: 'renovar'; id: string }
  | { tipo: 'devolver'; id: string }
  | { tipo: 'detalhe'; id: string }
  | null

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const unicos = (xs: string[]) => Array.from(new Set(xs.filter(Boolean))).sort((a, b) => a.localeCompare(b, 'pt-BR'))

export default function App() {
  const store = useMemo(() => getStore(), [])
  const sb = useMemo(() => supabase(), [])
  const [prefs, updatePrefs] = usePrefs()
  const [logado, setLogado] = useState<boolean | null>(sb ? null : true)
  const [lista, setLista] = useState<Locacao[]>([])
  const [fotos, setFotos] = useState<Record<string, { recebimento: number; entrega: number }>>({})
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [aba, setAba] = useState<Aba>('lista')
  const [filtro, setFiltro] = useState<Filtro>('ativos')
  const [obra, setObra] = useState('')
  const [busca, setBusca] = useState('')
  const [modal, setModal] = useState<ModalState>(null)
  const [admin, setAdmin] = useState(false)

  useEffect(() => {
    if (!sb) return
    sb.auth.getSession().then(({ data }) => setLogado(!!data.session))
    const { data } = sb.auth.onAuthStateChange((_e, s) => setLogado(!!s))
    return () => data.subscription.unsubscribe()
  }, [sb])

  const carregar = useCallback(async () => {
    try {
      const [ls, fs] = await Promise.all([store.listar(), store.contarFotos()])
      setLista(ls); setFotos(fs); setErro('')
    } catch (e) {
      setErro('Não foi possível carregar: ' + (e as Error).message)
    } finally { setCarregando(false) }
  }, [store])

  const recarregarFotos = useCallback(() => { store.contarFotos().then(setFotos).catch(() => {}) }, [store])

  useEffect(() => {
    if (!logado) return
    carregar()
    store.ehAdmin().then(setAdmin).catch(() => setAdmin(false))
  }, [logado, carregar, store])

  // Recalcula "dias restantes" quando o app volta do segundo plano em outro dia
  const [ref, setRef] = useState(hoje())
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === 'visible') { setRef(hoje()); if (logado) carregar() } }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [carregar, logado])

  const comSit = useMemo(
    () => lista.map(l => ({ l, sit: situacao(l, prefs.alertaDias, ref) })),
    [lista, prefs.alertaDias, ref],
  )
  const daObra = useMemo(() => (obra ? comSit.filter(x => x.l.obra === obra) : comSit), [comSit, obra])

  const contagem = useMemo(() => ({
    ativos: daObra.filter(x => x.l.status !== 'devolvido').length,
    alertas: daObra.filter(x => emAlerta(x.sit)).length,
    devolvidos: daObra.filter(x => x.l.status === 'devolvido').length,
    todos: daObra.length,
  }), [daObra])

  // Vindo do toque na notificação: abre direto no filtro de alertas
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('filtro') === 'alertas') {
      setFiltro('alertas')
      window.history.replaceState(null, '', '/')
    }
  }, [])

  useEffect(() => {
    // No modo Supabase quem avisa é o push do servidor; a notificação local é só do modo offline
    if (!prefs.notificar || store.modo !== 'local') return
    const alertas = comSit.filter(x => emAlerta(x.sit))
    notificarAlertas(alertas.length, alertas.map(x => x.l.equipamento))
  }, [comSit, prefs.notificar, store.modo])

  const visiveis = useMemo(() => {
    const q = norm(busca.trim())
    return daObra
      .filter(({ l, sit }) => {
        if (filtro === 'ativos' && l.status === 'devolvido') return false
        if (filtro === 'alertas' && !emAlerta(sit)) return false
        if (filtro === 'devolvidos' && l.status !== 'devolvido') return false
        if (q && !norm([l.equipamento, l.descricao, l.fornecedor, l.obra, l.contrato].join(' ')).includes(q)) return false
        return true
      })
      .sort((a, b) => {
        const dev = (x: typeof a) => x.l.status === 'devolvido'
        if (dev(a) !== dev(b)) return dev(a) ? 1 : -1
        if (dev(a)) return diffDias(a.l.dataDevolucao ?? a.l.dataFim, b.l.dataDevolucao ?? b.l.dataFim) // mais recentes primeiro
        return (a.sit.dias ?? 0) - (b.sit.dias ?? 0) // quem vence antes primeiro
      })
  }, [daObra, filtro, busca])

  const obras = useMemo(() => unicos(lista.map(l => l.obra)), [lista])
  const fornecedores = useMemo(() => unicos(lista.map(l => l.fornecedor)), [lista])
  const listaResumo = useMemo(() => daObra.map(x => x.l), [daObra])

  async function salvar(l: Locacao) {
    await store.salvar(l)
    setLista(prev => (prev.some(p => p.id === l.id) ? prev.map(p => (p.id === l.id ? l : p)) : [...prev, l]))
  }

  async function excluir(id: string) {
    await store.excluir(id)
    setLista(prev => prev.filter(p => p.id !== id))
    setModal(null)
    recarregarFotos()
  }

  const atual = modal && 'id' in modal ? lista.find(l => l.id === modal.id) : undefined

  if (logado === null) return <Centro><Loader2 className="animate-spin text-muted" /></Centro>
  if (!logado && sb) return <Login sb={sb} onOk={() => setLogado(true)} />

  const titulo = aba === 'lista' ? 'Equipamentos' : aba === 'resumo' ? 'Resumo de custos' : 'Ajustes'

  return (
    <div className="min-h-dvh pb-[84px]">
      <header className="sticky top-0 z-30 px-4 pt-[max(12px,env(safe-area-inset-top))] pb-3 space-y-3"
        style={{ background: 'var(--header-bg)', backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)' }}>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-[0.12em] font-semibold text-muted">CMR · Locados em obra</p>
            <h1 className="text-[26px] font-bold leading-tight truncate">{titulo}</h1>
          </div>
          {aba === 'lista' && (
            <button onClick={() => setModal({ tipo: 'novo' })} className="btn-accent rounded-xl pl-3 pr-4 py-2.5 text-sm flex items-center gap-1.5 shrink-0">
              <Plus size={17} /> Novo
            </button>
          )}
        </div>

        {aba !== 'ajustes' && obras.length > 0 && (
          <div className="relative">
            <HardHat size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
            <select value={obra} onChange={e => setObra(e.target.value)} className="input-glass !py-2 !pl-9 !text-sm appearance-none">
              <option value="">Todas as obras</option>
              {obras.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
        )}

        {aba === 'lista' && (
          <>
            <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-4 px-4">
              <Chip ativo={filtro === 'ativos'} onClick={() => setFiltro('ativos')} n={contagem.ativos} label="Ativos" />
              <Chip ativo={filtro === 'alertas'} onClick={() => setFiltro('alertas')} n={contagem.alertas} label="Alertas" alerta />
              <Chip ativo={filtro === 'devolvidos'} onClick={() => setFiltro('devolvidos')} n={contagem.devolvidos} label="Devolvidos" />
              <Chip ativo={filtro === 'todos'} onClick={() => setFiltro('todos')} n={contagem.todos} label="Todos" />
            </div>
            {lista.length > 4 && (
              <div className="relative">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
                <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar equipamento, fornecedor, contrato…" className="input-glass !py-2 !pl-9 !text-sm" />
              </div>
            )}
          </>
        )}
      </header>

      <main className="px-4 pt-1 max-w-[640px] mx-auto">
        {erro && <p className="text-sm rounded-xl px-3 py-2 mb-3" style={{ color: 'var(--c-rose)', background: 'color-mix(in srgb, var(--c-rose) 10%, transparent)' }}>{erro}</p>}

        {aba === 'lista' && (carregando ? (
          <Centro><Loader2 className="animate-spin text-muted" /></Centro>
        ) : visiveis.length === 0 ? (
          <div className="text-center py-16 px-6">
            <Package size={40} className="mx-auto text-muted-2 mb-3" />
            <p className="font-semibold">{lista.length === 0 ? 'Nenhum equipamento locado' : 'Nada neste filtro'}</p>
            <p className="text-sm text-muted mt-1">{lista.length === 0 ? 'Toque em "+ Novo" ao receber um equipamento na obra.' : filtro === 'alertas' ? 'Nenhum vencimento próximo. 👍' : 'Tente outro filtro ou obra.'}</p>
          </div>
        ) : (
          <div className="space-y-3 page-enter">
            {visiveis.map(({ l, sit }) => (
              <EquipCard key={l.id} l={l} sit={sit} fotos={fotos[l.id] ?? { recebimento: 0, entrega: 0 }}
                onAbrir={() => setModal({ tipo: 'detalhe', id: l.id })}
                onEditar={admin ? () => setModal({ tipo: 'editar', id: l.id }) : undefined}
                onRenovar={() => setModal({ tipo: 'renovar', id: l.id })}
                onDevolver={() => setModal({ tipo: 'devolver', id: l.id })} />
            ))}
          </div>
        ))}

        {aba === 'resumo' && <Resumo lista={listaResumo} alertaDias={prefs.alertaDias} obra={obra} />}
        {aba === 'ajustes' && (
          <Ajustes prefs={prefs} update={updatePrefs} store={store} lista={lista} onImportado={carregar}
            onSair={sb ? () => { sb.auth.signOut() } : undefined} />
        )}
      </main>

      <nav className="fixed bottom-0 inset-x-0 z-30 border-t border-border safe-bottom" style={{ background: 'var(--header-bg)', backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)' }}>
        <div className="grid grid-cols-3 max-w-[640px] mx-auto">
          <Tab ativo={aba === 'lista'} onClick={() => setAba('lista')} icon={<Package size={21} />} label="Equipamentos" badge={contagem.alertas} />
          <Tab ativo={aba === 'resumo'} onClick={() => setAba('resumo')} icon={<BarChart3 size={21} />} label="Resumo" />
          <Tab ativo={aba === 'ajustes'} onClick={() => setAba('ajustes')} icon={<Settings size={21} />} label="Ajustes" />
        </div>
      </nav>

      {modal?.tipo === 'novo' && (
        <FormModal fornecedores={fornecedores} obras={obras} obraPadrao={obra} onClose={() => setModal(null)}
          onSave={async (l, novo) => { await salvar(l); if (novo) setTimeout(() => setModal({ tipo: 'detalhe', id: l.id }), 0) }} />
      )}
      {modal?.tipo === 'editar' && atual && admin && (
        <FormModal editing={atual} fornecedores={fornecedores} obras={obras} onClose={() => setModal(null)} onSave={salvar} />
      )}
      {modal?.tipo === 'renovar' && atual && <RenovarModal l={atual} onClose={() => setModal(null)} onSave={salvar} />}
      {modal?.tipo === 'devolver' && atual && (
        <DevolverModal l={atual} onClose={() => setModal(null)} onSave={salvar}
          onConfirmada={l => setTimeout(() => setModal({ tipo: 'detalhe', id: l.id }), 0)} />
      )}
      {modal?.tipo === 'detalhe' && atual && (
        <DetalheModal l={atual} store={store} admin={admin} onClose={() => setModal(null)}
          onEditar={() => setModal({ tipo: 'editar', id: atual.id })}
          onSave={salvar} onExcluir={() => excluir(atual.id)} onFotosChange={recarregarFotos} />
      )}
    </div>
  )
}

function Centro({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center justify-center py-20">{children}</div>
}

function Chip({ ativo, onClick, n, label, alerta }: { ativo: boolean; onClick: () => void; n: number; label: string; alerta?: boolean }) {
  const destaque = alerta && n > 0
  return (
    <button onClick={onClick}
      className="shrink-0 rounded-full px-3.5 py-1.5 text-sm font-semibold flex items-center gap-1.5 transition-all"
      style={ativo
        ? { background: destaque ? 'var(--c-brown)' : 'var(--accent)', color: '#fff', border: '1px solid transparent' }
        : { background: 'var(--glass-bg-sm)', color: 'var(--color-fg)', border: '1px solid var(--color-border)' }}>
      <span style={{ color: ativo ? '#fff' : destaque ? 'var(--c-rose)' : 'var(--accent)' }}>{n}</span> {label}
    </button>
  )
}

function Tab({ ativo, onClick, icon, label, badge }: { ativo: boolean; onClick: () => void; icon: React.ReactNode; label: string; badge?: number }) {
  return (
    <button onClick={onClick} className="relative flex flex-col items-center gap-0.5 pt-2.5 pb-2 text-[11px] font-semibold"
      style={{ color: ativo ? 'var(--accent)' : 'var(--color-muted)' }}>
      {icon}
      {label}
      {!!badge && (
        <span className="absolute top-1.5 left-1/2 ml-2 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold flex items-center justify-center"
          style={{ background: 'var(--c-rose)', color: '#fff' }}>{badge}</span>
      )}
    </button>
  )
}
