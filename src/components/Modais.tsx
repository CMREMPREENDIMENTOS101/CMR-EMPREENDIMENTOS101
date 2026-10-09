'use client'

import { useMemo, useState } from 'react'
import { MessageCircle, Phone, Trash2, Undo2 } from 'lucide-react'
import Modal from './Modal'
import Fotos from './Fotos'
import { Pill } from './EquipCard'
import type { Store } from '@/lib/store'
import type { Locacao, Periodo } from '@/lib/types'
import { PERIODO_LABEL, PERIODO_UNIDADE } from '@/lib/types'
import {
  addPeriodo, brl, custoIncorrido, custoIntervalo, valorDia, custoPrevisto, diffDias, fimCobranca, fmtData, hoje,
  DIAS_PERIODO, diasCobrados, parseValor, uid, valorPorPeriodo,
} from '@/lib/calc'

const fmtNum = (n: number) => (n ? n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '')

function Erro({ msg }: { msg: string }) {
  if (!msg) return null
  return <p className="text-sm rounded-xl px-3 py-2 mb-3" style={{ color: 'var(--c-rose)', background: 'color-mix(in srgb, var(--c-rose) 10%, transparent)' }}>{msg}</p>
}

// ─── Cadastro / edição ────────────────────────────────────────
export function FormModal({ editing, fornecedores, obras, obraPadrao, onClose, onSave }: {
  editing?: Locacao
  fornecedores: string[]
  obras: string[]
  obraPadrao?: string
  onClose: () => void
  onSave: (l: Locacao, novo: boolean) => Promise<void>
}) {
  const entrada0 = editing?.dataEntrada ?? hoje()
  const [f, setF] = useState({
    equipamento: editing?.equipamento ?? '',
    quantidade: String(editing?.quantidade ?? 1),
    descricao: editing?.descricao ?? '',
    fornecedor: editing?.fornecedor ?? '',
    contato: editing?.contato ?? '',
    obra: editing?.obra ?? obraPadrao ?? '',
    contrato: editing?.contrato ?? '',
    periodo: (editing?.periodo ?? 'mensal') as Periodo,
    valorUnitario: fmtNum(editing?.valorUnitario ?? 0),
    frete: fmtNum(editing?.frete ?? 0),
    dataEntrada: entrada0,
    dataFim: editing?.dataFim ?? addPeriodo(entrada0, 'mensal'),
    observacoes: editing?.observacoes ?? '',
  })
  // Enquanto o usuário não mexer no vencimento, ele acompanha entrada + 1 período
  const [fimManual, setFimManual] = useState(!!editing)
  const [erro, setErro] = useState('')
  const [salvando, setSalvando] = useState(false)

  function set<K extends keyof typeof f>(k: K, v: (typeof f)[K]) {
    setF(prev => {
      const next = { ...prev, [k]: v }
      if (!fimManual && (k === 'dataEntrada' || k === 'periodo') && next.dataEntrada) {
        next.dataFim = addPeriodo(next.dataEntrada, next.periodo)
      }
      return next
    })
  }

  const qtd = Math.max(1, parseInt(f.quantidade) || 1)
  const porPeriodo = parseValor(f.valorUnitario) * qtd
  const dias = f.dataEntrada && f.dataFim && diffDias(f.dataEntrada, f.dataFim) >= 0
    ? diasCobrados(f.dataEntrada, f.dataFim) : 0
  const porDia = porPeriodo / DIAS_PERIODO[f.periodo]
  const [un1] = PERIODO_UNIDADE[f.periodo]

  async function salvar(e: React.FormEvent) {
    e.preventDefault()
    if (!f.equipamento.trim()) return setErro('Informe o equipamento.')
    if (!f.dataEntrada || !f.dataFim) return setErro('Informe as datas de entrada e de vencimento.')
    if (diffDias(f.dataEntrada, f.dataFim) < 0) return setErro('O vencimento não pode ser antes da entrada.')
    setSalvando(true); setErro('')
    const agora = new Date().toISOString()
    const l: Locacao = {
      id: editing?.id ?? uid(),
      equipamento: f.equipamento.trim(),
      quantidade: qtd,
      descricao: f.descricao.trim(),
      fornecedor: f.fornecedor.trim(),
      contato: f.contato.trim(),
      obra: f.obra.trim(),
      contrato: f.contrato.trim(),
      periodo: f.periodo,
      valorUnitario: parseValor(f.valorUnitario),
      frete: parseValor(f.frete),
      dataEntrada: f.dataEntrada,
      dataFim: f.dataFim,
      renovacoes: editing?.renovacoes ?? [],
      status: editing?.status ?? 'ativo',
      devolucaoPrevista: editing?.devolucaoPrevista ?? null,
      dataDevolucao: editing?.dataDevolucao ?? null,
      observacoes: f.observacoes.trim(),
      criadoEm: editing?.criadoEm ?? agora,
      atualizadoEm: agora,
    }
    try { await onSave(l, !editing); onClose() }
    catch (err) { setErro((err as Error).message); setSalvando(false) }
  }

  return (
    <Modal
      variant="sheet"
      title={editing ? 'Editar locação' : 'Nova locação'}
      subtitle={editing ? editing.equipamento : 'Equipamento recebido na obra'}
      onClose={onClose}
      footer={
        <button form="form-locacao" disabled={salvando} className="btn-accent w-full rounded-xl py-3.5 text-[15px]">
          {salvando ? 'Salvando…' : editing ? 'Salvar alterações' : 'Cadastrar e tirar fotos'}
        </button>
      }
    >
      <form id="form-locacao" onSubmit={salvar} className="space-y-3.5">
        <Erro msg={erro} />
        <div className="grid grid-cols-[1fr_84px] gap-3">
          <div>
            <label className="label-field">Equipamento *</label>
            <input className="input-glass" placeholder="Ex: Martelete 10kg" value={f.equipamento} onChange={e => set('equipamento', e.target.value)} />
          </div>
          <div>
            <label className="label-field">Qtd.</label>
            <input className="input-glass text-center" inputMode="numeric" value={f.quantidade} onChange={e => set('quantidade', e.target.value.replace(/\D/g, ''))} />
          </div>
        </div>
        <div>
          <label className="label-field">Descrição / acessórios</label>
          <input className="input-glass" placeholder="Ex: 2 ponteiros, 2 talhadeiras" value={f.descricao} onChange={e => set('descricao', e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label-field">Fornecedor</label>
            <input className="input-glass" list="dl-fornecedores" placeholder="Locadora" value={f.fornecedor} onChange={e => set('fornecedor', e.target.value)} />
            <datalist id="dl-fornecedores">{fornecedores.map(x => <option key={x} value={x} />)}</datalist>
          </div>
          <div>
            <label className="label-field">Telefone</label>
            <input className="input-glass" inputMode="tel" placeholder="(00) 00000-0000" value={f.contato} onChange={e => set('contato', e.target.value)} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label-field">Obra</label>
            <input className="input-glass" list="dl-obras" placeholder="Obra" value={f.obra} onChange={e => set('obra', e.target.value)} />
            <datalist id="dl-obras">{obras.map(x => <option key={x} value={x} />)}</datalist>
          </div>
          <div>
            <label className="label-field">Nº contrato / NF</label>
            <input className="input-glass" value={f.contrato} onChange={e => set('contrato', e.target.value)} />
          </div>
        </div>

        <div>
          <label className="label-field">Cobrança</label>
          <div className="grid grid-cols-4 gap-1.5">
            {(Object.keys(PERIODO_LABEL) as Periodo[]).map(p => (
              <button type="button" key={p} onClick={() => set('periodo', p)}
                className={`rounded-xl py-2 text-[13px] font-semibold ${f.periodo === p ? 'btn-accent' : 'btn-ghost'}`}>
                {PERIODO_LABEL[p]}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label-field">Valor unit. / {un1}</label>
            <input className="input-glass" inputMode="decimal" placeholder="0,00" value={f.valorUnitario} onChange={e => set('valorUnitario', e.target.value)} />
          </div>
          <div>
            <label className="label-field">Frete / taxas</label>
            <input className="input-glass" inputMode="decimal" placeholder="0,00" value={f.frete} onChange={e => set('frete', e.target.value)} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label-field">Entrada *</label>
            <input type="date" className="input-glass" value={f.dataEntrada} onChange={e => set('dataEntrada', e.target.value)} />
          </div>
          <div>
            <label className="label-field">Vencimento *</label>
            <input type="date" className="input-glass" value={f.dataFim} onChange={e => { setFimManual(true); set('dataFim', e.target.value) }} />
          </div>
        </div>

        {porPeriodo > 0 && dias > 0 && (
          <div className="rounded-xl px-3.5 py-3 text-sm" style={{ background: 'rgb(var(--accent-rgb) / 0.07)', border: '1px solid rgb(var(--accent-rgb) / 0.18)' }}>
            <div className="flex justify-between"><span className="text-muted">{brl(porDia)}/dia × {dias} dia{dias > 1 ? 's' : ''}</span><span>{brl(porDia * dias)}</span></div>
            {parseValor(f.frete) > 0 && <div className="flex justify-between"><span className="text-muted">Frete / taxas</span><span>{brl(parseValor(f.frete))}</span></div>}
            <div className="flex justify-between font-bold mt-1"><span>Total previsto</span><span>{brl(Math.round(porDia * dias * 100) / 100 + parseValor(f.frete))}</span></div>
          </div>
        )}

        <div>
          <label className="label-field">Observações</label>
          <textarea className="input-glass min-h-[70px]" value={f.observacoes} onChange={e => set('observacoes', e.target.value)} />
        </div>
      </form>
    </Modal>
  )
}

// ─── Renovar ──────────────────────────────────────────────────
export function RenovarModal({ l, onClose, onSave }: {
  l: Locacao
  onClose: () => void
  onSave: (l: Locacao) => Promise<void>
}) {
  const [novoFim, setNovoFim] = useState(addPeriodo(l.dataFim, l.periodo))
  const [erro, setErro] = useState('')
  const [salvando, setSalvando] = useState(false)
  const dias = novoFim && diffDias(l.dataFim, novoFim) > 0 ? diffDias(l.dataFim, novoFim) : 0

  async function confirmar() {
    if (!novoFim || diffDias(l.dataFim, novoFim) <= 0) return setErro(`A nova data deve ser depois de ${fmtData(l.dataFim)}.`)
    setSalvando(true)
    try {
      await onSave({
        ...l,
        dataFim: novoFim,
        renovacoes: [...l.renovacoes, { em: hoje(), fimAnterior: l.dataFim, novoFim }],
        // Renovar cancela uma retirada que estava agendada
        status: 'ativo',
        devolucaoPrevista: null,
        atualizadoEm: new Date().toISOString(),
      })
      onClose()
    } catch (e) { setErro((e as Error).message); setSalvando(false) }
  }

  return (
    <Modal icon="🔄" title="Renovar locação" subtitle={`${l.equipamento} — ajuste a nova data de vencimento se necessário.`} onClose={onClose}
      footer={
        <div className="grid grid-cols-[auto_1fr] gap-2">
          <button onClick={onClose} className="btn-ghost rounded-xl px-5 py-3.5 text-[15px]">Cancelar</button>
          <button onClick={confirmar} disabled={salvando} className="btn-accent rounded-xl py-3.5 text-[15px]">🔄 Confirmar renovação</button>
        </div>
      }>
      <Erro msg={erro} />
      <label className="label-field">Nova data de fim</label>
      <input type="date" className="input-glass text-center" value={novoFim} min={l.dataFim} onChange={e => { setNovoFim(e.target.value); setErro('') }} />
      <p className="text-xs text-muted mt-2">
        Vencimento atual: {fmtData(l.dataFim)}
        {dias > 0 && valorPorPeriodo(l) > 0 && <> · +{dias} dias = <b className="text-fg">{brl(custoIntervalo(l, l.dataFim, novoFim))}</b></>}
      </p>
    </Modal>
  )
}

// ─── Devolver ─────────────────────────────────────────────────
export function DevolverModal({ l, onClose, onSave, onConfirmada }: {
  l: Locacao
  onClose: () => void
  onSave: (l: Locacao) => Promise<void>
  /** Chamado após confirmar, para abrir as fotos de entrega */
  onConfirmada: (l: Locacao) => void
}) {
  const [data, setData] = useState(l.devolucaoPrevista ?? hoje())
  const [erro, setErro] = useState('')
  const [salvando, setSalvando] = useState(false)

  async function gravar(next: Locacao) {
    setSalvando(true)
    try { await onSave(next); return true }
    catch (e) { setErro((e as Error).message); setSalvando(false); return false }
  }

  async function agendar() {
    if (!data) return setErro('Informe a data.')
    if (diffDias(hoje(), data) < 0) return setErro('Para agendar, use uma data de hoje em diante.')
    if (await gravar({ ...l, status: 'devolucao_agendada', devolucaoPrevista: data, atualizadoEm: new Date().toISOString() })) onClose()
  }

  async function confirmar() {
    if (!data) return setErro('Informe a data.')
    if (diffDias(data, hoje()) < 0) return setErro('Não dá para confirmar uma devolução futura — use "Agendar".')
    if (diffDias(l.dataEntrada, data) < 0) return setErro('A devolução não pode ser antes da entrada.')
    const next: Locacao = { ...l, status: 'devolvido', dataDevolucao: data, atualizadoEm: new Date().toISOString() }
    if (await gravar(next)) { onClose(); onConfirmada(next) }
  }

  async function cancelarAgendamento() {
    if (await gravar({ ...l, status: 'ativo', devolucaoPrevista: null, atualizadoEm: new Date().toISOString() })) onClose()
  }

  return (
    <Modal icon="📦" title="Devolução do equipamento" subtitle={`${l.equipamento} — agende a retirada ou confirme a devolução agora.`} onClose={onClose}
      footer={
        <div className="space-y-2">
          <button onClick={agendar} disabled={salvando} className="w-full rounded-xl py-3.5 text-[15px] font-semibold text-white" style={{ background: 'var(--c-brown)', color: '#fff' }}>📅 Agendar devolução</button>
          <button onClick={confirmar} disabled={salvando} className="btn-accent w-full rounded-xl py-3.5 text-[15px]">📦 Confirmar devolução</button>
          {l.status === 'devolucao_agendada' && (
            <button onClick={cancelarAgendamento} disabled={salvando} className="w-full py-2.5 text-sm font-semibold" style={{ color: 'var(--c-rose)' }}>Cancelar agendamento</button>
          )}
          <button onClick={onClose} className="w-full py-2.5 text-sm font-semibold text-muted">Cancelar</button>
        </div>
      }>
      <Erro msg={erro} />
      <label className="label-field">Data</label>
      <input type="date" className="input-glass text-center" value={data} onChange={e => { setData(e.target.value); setErro('') }} />
      <p className="text-xs text-muted mt-2">Hoje para confirmar a devolução, ou a data prevista para agendar a retirada.</p>
      {l.status === 'devolucao_agendada' && <p className="text-xs mt-2" style={{ color: 'var(--c-brown)' }}>Retirada agendada para {fmtData(l.devolucaoPrevista)}.</p>}
    </Modal>
  )
}

// ─── Detalhe ──────────────────────────────────────────────────
export function DetalheModal({ l, store, admin, onClose, onEditar, onSave, onExcluir, onFotosChange }: {
  l: Locacao
  store: Store
  admin: boolean
  onClose: () => void
  onEditar: () => void
  onSave: (l: Locacao) => Promise<void>
  onExcluir: () => Promise<void>
  onFotosChange: () => void
}) {
  const ref = hoje()
  const [un1] = PERIODO_UNIDADE[l.periodo]
  const dias = diasCobrados(l.dataEntrada, fimCobranca(l, ref))
  const tel = l.contato.replace(/\D/g, '')
  const whats = tel ? `https://wa.me/${tel.length <= 11 ? '55' + tel : tel}?text=${encodeURIComponent(`Olá! Sobre a locação de ${l.equipamento}${l.obra ? ` na obra ${l.obra}` : ''}${l.contrato ? ` (contrato ${l.contrato})` : ''}: `)}` : ''

  const historico = useMemo(() => {
    const h: { data: string; texto: string }[] = [{ data: l.dataEntrada, texto: `Entrada na obra — vencimento ${fmtData(l.renovacoes[0]?.fimAnterior ?? l.dataFim)}` }]
    l.renovacoes.forEach((r, i) => h.push({ data: r.em, texto: `${i + 1}ª renovação: ${fmtData(r.fimAnterior)} → ${fmtData(r.novoFim)}` }))
    if (l.status === 'devolucao_agendada') h.push({ data: l.devolucaoPrevista ?? '', texto: 'Retirada agendada' })
    if (l.status === 'devolvido') h.push({ data: l.dataDevolucao ?? '', texto: 'Devolvido à locadora' })
    return h
  }, [l])

  async function reabrir() {
    if (!confirm('Desfazer a devolução e voltar a locação para ativa?')) return
    await onSave({ ...l, status: 'ativo', dataDevolucao: null, devolucaoPrevista: null, atualizadoEm: new Date().toISOString() })
  }

  async function excluir() {
    if (!confirm(`Excluir a locação "${l.equipamento}" e todas as fotos? Não dá para desfazer.`)) return
    await onExcluir()
  }

  return (
    <Modal variant="sheet" title={l.equipamento} subtitle={[l.fornecedor, l.obra].filter(Boolean).join(' · ') || undefined} onClose={onClose}
      footer={admin &&
        <div className="grid grid-cols-[auto_1fr] gap-2">
          <button onClick={excluir} aria-label="Excluir" className="btn-ghost rounded-xl px-4 py-3" style={{ color: 'var(--c-rose)' }}><Trash2 size={18} /></button>
          <button onClick={onEditar} className="btn-accent rounded-xl py-3 text-[15px]">Editar dados</button>
        </div>
      }>
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-2">
          <Box label={`Valor / ${un1}`} valor={brl(valorPorPeriodo(l))} sub={`${l.quantidade} un × ${brl(l.valorUnitario)}`} />
          <Box label="Gasto até hoje" valor={brl(custoIncorrido(l, ref))} />
          <Box label={l.status === 'devolvido' ? 'Total final' : 'Total previsto'} valor={brl(custoPrevisto(l, ref))} sub={`${dias} dias × ${brl(valorDia(l))}${l.frete ? ` + ${brl(l.frete)} frete` : ''}`} destaque />
          <Box label="Período" valor={`${fmtData(l.dataEntrada).slice(0, 5)} → ${fmtData(l.status === 'devolvido' ? l.dataDevolucao : l.dataFim).slice(0, 5)}`} sub={`${diffDias(l.dataEntrada, l.status === 'devolvido' && l.dataDevolucao ? l.dataDevolucao : ref)} dias na obra`} />
        </div>

        {(l.descricao || l.contrato || l.observacoes) && (
          <div className="text-sm space-y-1">
            {l.descricao && <p><span className="text-muted">Descrição:</span> {l.descricao}</p>}
            {l.contrato && <p><span className="text-muted">Contrato/NF:</span> {l.contrato}</p>}
            {l.observacoes && <p className="whitespace-pre-wrap"><span className="text-muted">Obs.:</span> {l.observacoes}</p>}
          </div>
        )}

        {tel && (
          <div className="grid grid-cols-2 gap-2">
            <a href={`tel:${tel}`} className="btn-ghost rounded-xl py-2.5 text-sm flex items-center justify-center gap-2"><Phone size={15} /> Ligar</a>
            <a href={whats} target="_blank" rel="noreferrer" className="btn-ghost rounded-xl py-2.5 text-sm flex items-center justify-center gap-2"><MessageCircle size={15} /> WhatsApp</a>
          </div>
        )}

        <Fotos store={store} locacaoId={l.id} tipo="recebimento" onChange={onFotosChange} podeExcluir={admin} />
        {(l.status !== 'ativo') && <Fotos store={store} locacaoId={l.id} tipo="entrega" onChange={onFotosChange} podeExcluir={admin} />}

        <div>
          <p className="label-field">Histórico</p>
          <ol className="space-y-2">
            {historico.map((h, i) => (
              <li key={i} className="flex gap-3 text-sm">
                <span className="text-muted w-[78px] shrink-0 tabular-nums">{fmtData(h.data)}</span>
                <span>{h.texto}</span>
              </li>
            ))}
          </ol>
        </div>

        {admin && l.status === 'devolvido' && (
          <button onClick={reabrir} className="text-sm font-semibold text-muted flex items-center gap-1.5"><Undo2 size={15} /> Desfazer devolução</button>
        )}
        <div className="flex gap-1.5 flex-wrap"><Pill>{PERIODO_LABEL[l.periodo]}</Pill>{l.renovacoes.length > 0 && <Pill cor="var(--c-sky)">{l.renovacoes.length}x renovado</Pill>}</div>
      </div>
    </Modal>
  )
}

function Box({ label, valor, sub, destaque }: { label: string; valor: string; sub?: string; destaque?: boolean }) {
  return (
    <div className="rounded-xl px-3 py-2.5" style={destaque
      ? { background: 'rgb(var(--accent-rgb) / 0.08)', border: '1px solid rgb(var(--accent-rgb) / 0.2)' }
      : { background: 'rgb(var(--ink-rgb) / 0.04)', border: '1px solid var(--color-border)' }}>
      <p className="text-[10px] uppercase tracking-wider font-semibold text-muted">{label}</p>
      <p className="text-[15px] font-bold text-fg mt-0.5">{valor}</p>
      {sub && <p className="text-[11px] text-muted mt-0.5">{sub}</p>}
    </div>
  )
}
