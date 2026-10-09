'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Camera, ImagePlus, Loader2, Trash2, X } from 'lucide-react'
import type { Foto, TipoFoto } from '@/lib/types'
import type { Store } from '@/lib/store'

const TITULO: Record<TipoFoto, string> = { recebimento: 'Fotos de recebimento', entrega: 'Fotos de entrega' }

/** Galeria de um tipo de foto, com câmera, galeria e visualização em tela cheia */
export default function Fotos({ store, locacaoId, tipo, onChange, readOnly }: {
  store: Store
  locacaoId: string
  tipo: TipoFoto
  onChange?: () => void
  readOnly?: boolean
}) {
  const [fotos, setFotos] = useState<(Foto & { src: string })[]>([])
  const [enviando, setEnviando] = useState(0)
  const [erro, setErro] = useState('')
  const [aberta, setAberta] = useState<string | null>(null)
  const cameraRef = useRef<HTMLInputElement>(null)
  const galeriaRef = useRef<HTMLInputElement>(null)
  const urls = useRef<string[]>([])

  const carregar = useCallback(async () => {
    const todas = (await store.listarFotos(locacaoId)).filter(f => f.tipo === tipo)
    const comSrc = await Promise.all(todas.map(async f => ({ ...f, src: await store.urlFoto(f) })))
    urls.current.forEach(u => u.startsWith('blob:') && URL.revokeObjectURL(u))
    urls.current = comSrc.map(f => f.src)
    setFotos(comSrc)
  }, [store, locacaoId, tipo])

  useEffect(() => {
    carregar().catch(e => setErro(String(e.message ?? e)))
    return () => urls.current.forEach(u => u.startsWith('blob:') && URL.revokeObjectURL(u))
  }, [carregar])

  async function adicionar(files: FileList | null) {
    if (!files?.length) return
    setErro('')
    const lista = Array.from(files)
    setEnviando(n => n + lista.length)
    for (const f of lista) {
      try { await store.adicionarFoto(locacaoId, tipo, f) }
      catch (e) { setErro('Falha ao salvar foto: ' + ((e as Error).message ?? e)) }
      finally { setEnviando(n => n - 1) }
    }
    await carregar()
    onChange?.()
  }

  async function remover(f: Foto) {
    if (!confirm('Excluir esta foto?')) return
    await store.excluirFoto(f)
    setAberta(null)
    await carregar()
    onChange?.()
  }

  const fotoAberta = fotos.find(f => f.id === aberta)

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="label-field !mb-0">{TITULO[tipo]} ({fotos.length})</p>
        {!readOnly && (
          <div className="flex gap-2">
            <button type="button" onClick={() => cameraRef.current?.click()} className="btn-ghost rounded-xl px-3 py-1.5 text-xs flex items-center gap-1.5">
              <Camera size={14} /> Câmera
            </button>
            <button type="button" onClick={() => galeriaRef.current?.click()} className="btn-ghost rounded-xl px-3 py-1.5 text-xs flex items-center gap-1.5">
              <ImagePlus size={14} /> Galeria
            </button>
          </div>
        )}
      </div>
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden
        onChange={e => { adicionar(e.target.files); e.target.value = '' }} />
      <input ref={galeriaRef} type="file" accept="image/*" multiple hidden
        onChange={e => { adicionar(e.target.files); e.target.value = '' }} />

      {erro && <p className="text-xs mb-2" style={{ color: 'var(--c-rose)' }}>{erro}</p>}

      {fotos.length === 0 && enviando === 0 ? (
        <p className="text-xs text-muted-2 py-3 text-center rounded-xl" style={{ background: 'rgb(var(--ink-rgb) / 0.03)' }}>
          Nenhuma foto. Registre o estado do equipamento.
        </p>
      ) : (
        <div className="grid grid-cols-4 gap-2">
          {fotos.map(f => (
            <button key={f.id} type="button" onClick={() => setAberta(f.id)} className="aspect-square rounded-xl overflow-hidden border border-border">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={f.src} alt="" className="w-full h-full object-cover" loading="lazy" />
            </button>
          ))}
          {Array.from({ length: enviando }).map((_, i) => (
            <div key={'up' + i} className="aspect-square rounded-xl border border-border flex items-center justify-center">
              <Loader2 size={18} className="animate-spin text-muted" />
            </div>
          ))}
        </div>
      )}

      {fotoAberta && (
        <div className="fixed inset-0 z-[60] bg-black/90 flex flex-col animate-fade-in" onClick={() => setAberta(null)}>
          <div className="flex items-center justify-between p-4 text-white/80" style={{ color: '#fff' }}>
            <span className="text-sm">{new Date(fotoAberta.criadoEm).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</span>
            <div className="flex gap-2">
              {!readOnly && (
                <button onClick={e => { e.stopPropagation(); remover(fotoAberta) }} aria-label="Excluir foto"
                  className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: 'rgba(255,255,255,.12)', color: '#fff' }}>
                  <Trash2 size={18} />
                </button>
              )}
              <button aria-label="Fechar" className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: 'rgba(255,255,255,.12)', color: '#fff' }}>
                <X size={18} />
              </button>
            </div>
          </div>
          <div className="flex-1 flex items-center justify-center p-2 min-h-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={fotoAberta.src} alt="" className="max-w-full max-h-full object-contain" />
          </div>
        </div>
      )}
    </div>
  )
}
