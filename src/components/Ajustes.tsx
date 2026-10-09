'use client'

import { useRef, useState } from 'react'
import { Bell, Database, Download, LogOut, Moon, Sun, Upload } from 'lucide-react'
import type { Prefs } from '@/lib/prefs'
import type { Store } from '@/lib/store'
import type { Locacao } from '@/lib/types'
import { hoje } from '@/lib/calc'

export default function Ajustes({ prefs, update, store, lista, onImportado, onSair }: {
  prefs: Prefs
  update: (p: Partial<Prefs>) => void
  store: Store
  lista: Locacao[]
  onImportado: () => void
  onSair?: () => void
}) {
  const [msg, setMsg] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const suportaNotif = typeof Notification !== 'undefined'

  async function alternarNotif() {
    if (prefs.notificar) return update({ notificar: false })
    if (!suportaNotif) return setMsg('Este navegador não suporta notificações. No iPhone, instale o app na Tela de Início primeiro (iOS 16.4+).')
    const p = await Notification.requestPermission()
    if (p === 'granted') update({ notificar: true })
    else setMsg('Permissão negada. Libere as notificações nas configurações do navegador.')
  }

  function exportar() {
    const blob = new Blob([JSON.stringify({ versao: 1, exportadoEm: new Date().toISOString(), locacoes: lista }, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `backup-equipamentos-${hoje()}.json`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 2000)
  }

  async function importar(file: File | undefined) {
    if (!file) return
    try {
      const dados = JSON.parse(await file.text())
      const itens: Locacao[] = Array.isArray(dados) ? dados : dados.locacoes
      if (!Array.isArray(itens) || itens.some(i => !i.id || !i.equipamento || !i.dataEntrada)) throw new Error('arquivo não é um backup deste app')
      if (!confirm(`Importar ${itens.length} locação(ões)? Registros com o mesmo ID serão sobrescritos.`)) return
      for (const i of itens) await store.salvar(i)
      setMsg(`${itens.length} locação(ões) importada(s). Fotos não vão no backup.`)
      onImportado()
    } catch (e) { setMsg('Falha ao importar: ' + (e as Error).message) }
  }

  return (
    <div className="space-y-3 page-enter">
      <section className="glass rounded-2xl p-4">
        <label className="label-field">Avisar quantos dias antes do vencimento</label>
        <div className="grid grid-cols-5 gap-1.5">
          {[2, 3, 5, 7, 10].map(n => (
            <button key={n} onClick={() => update({ alertaDias: n })}
              className={`rounded-xl py-2.5 text-sm font-semibold ${prefs.alertaDias === n ? 'btn-accent' : 'btn-ghost'}`}>{n}d</button>
          ))}
        </div>
      </section>

      <Linha icon={<Bell size={18} />} titulo="Notificação diária de alertas"
        sub="Ao abrir o app, avisa no aparelho o que vence (1x por dia)." onClick={alternarNotif} ligado={prefs.notificar} />
      <Linha icon={prefs.tema === 'dark' ? <Moon size={18} /> : <Sun size={18} />} titulo="Tema escuro"
        sub="Mesmo tema do ERP CMR." onClick={() => update({ tema: prefs.tema === 'dark' ? 'light' : 'dark' })} ligado={prefs.tema === 'dark'} />

      <section className="glass rounded-2xl p-4 space-y-3">
        <div className="flex items-center gap-3">
          <Database size={18} className="text-muted" />
          <div>
            <p className="text-sm font-semibold">{store.modo === 'supabase' ? 'Dados na nuvem (Supabase)' : 'Dados só neste aparelho'}</p>
            <p className="text-xs text-muted">{store.modo === 'supabase'
              ? 'Compartilhado entre todos os usuários da plataforma.'
              : 'Sem servidor configurado. Faça backup — limpar o navegador apaga tudo.'}</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button onClick={exportar} className="btn-ghost rounded-xl py-2.5 text-sm flex items-center justify-center gap-2"><Download size={15} /> Backup</button>
          <button onClick={() => fileRef.current?.click()} className="btn-ghost rounded-xl py-2.5 text-sm flex items-center justify-center gap-2"><Upload size={15} /> Restaurar</button>
        </div>
        <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={e => { importar(e.target.files?.[0]); e.target.value = '' }} />
      </section>

      {msg && <p className="text-sm text-muted px-1">{msg}</p>}

      {onSair && (
        <button onClick={onSair} className="btn-ghost w-full rounded-xl py-3 text-sm flex items-center justify-center gap-2" style={{ color: 'var(--c-rose)' }}>
          <LogOut size={16} /> Sair
        </button>
      )}
    </div>
  )
}

function Linha({ icon, titulo, sub, onClick, ligado }: { icon: React.ReactNode; titulo: string; sub: string; onClick: () => void; ligado: boolean }) {
  return (
    <button onClick={onClick} className="glass rounded-2xl p-4 w-full flex items-center gap-3 text-left">
      <span className="text-muted">{icon}</span>
      <span className="flex-1">
        <span className="block text-sm font-semibold">{titulo}</span>
        <span className="block text-xs text-muted">{sub}</span>
      </span>
      <span className="w-11 h-6 rounded-full relative transition-colors shrink-0" style={{ background: ligado ? 'var(--accent)' : 'rgb(var(--ink-rgb) / 0.15)' }}>
        <span className="absolute top-0.5 w-5 h-5 rounded-full bg-[#fff] transition-all" style={{ left: ligado ? 22 : 2, background: '#fff' }} />
      </span>
    </button>
  )
}
