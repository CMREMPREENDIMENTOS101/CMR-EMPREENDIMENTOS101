'use client'

import { useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'

/** Mesmo login do ERP (Supabase Auth). O acesso aos dados é liberado pelas policies (app_users ativo). */
export default function Login({ sb, onOk }: { sb: SupabaseClient; onOk: () => void }) {
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState('')
  const [carregando, setCarregando] = useState(false)

  async function entrar(e: React.FormEvent) {
    e.preventDefault()
    setCarregando(true); setErro('')
    const { error } = await sb.auth.signInWithPassword({ email: email.trim().toLowerCase(), password: senha })
    setCarregando(false)
    if (error) return setErro(error.message === 'Invalid login credentials' ? 'E-mail ou senha incorretos.' : error.message)
    onOk()
  }

  return (
    <main className="min-h-dvh flex items-center justify-center p-5">
      <form onSubmit={entrar} className="glass rounded-3xl p-6 w-full max-w-[380px] space-y-4">
        <div className="text-center">
          <div className="text-4xl mb-2">🏗️</div>
          <h1 className="text-xl font-bold">Equipamentos</h1>
          <p className="text-sm text-muted">CMR Empreendimentos — entre com o login da plataforma</p>
        </div>
        {erro && <p className="text-sm text-center" style={{ color: 'var(--c-rose)' }}>{erro}</p>}
        <div>
          <label className="label-field">E-mail</label>
          <input className="input-glass" type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} />
        </div>
        <div>
          <label className="label-field">Senha</label>
          <input className="input-glass" type="password" autoComplete="current-password" value={senha} onChange={e => setSenha(e.target.value)} />
        </div>
        <button disabled={carregando} className="btn-accent w-full rounded-xl py-3.5">{carregando ? 'Entrando…' : 'Entrar'}</button>
      </form>
    </main>
  )
}
