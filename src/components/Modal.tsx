'use client'

import { useEffect } from 'react'
import { X } from 'lucide-react'

interface Props {
  title: string
  subtitle?: string
  /** Emoji/ícone grande no topo, como nos diálogos de Renovar/Devolver */
  icon?: React.ReactNode
  onClose: () => void
  children: React.ReactNode
  footer?: React.ReactNode
  /** sheet = sobe de baixo ocupando a largura (formulários longos); dialog = cartão central */
  variant?: 'sheet' | 'dialog'
}

export default function Modal({ title, subtitle, icon, onClose, children, footer, variant = 'dialog' }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = '' }
  }, [onClose])

  const sheet = variant === 'sheet'

  return (
    <div
      className={`fixed inset-0 z-50 flex ${sheet ? 'items-end sm:items-center' : 'items-center'} justify-center ${sheet ? 'sm:p-4' : 'p-5'} animate-fade-in`}
      style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`w-full max-w-[480px] flex flex-col animate-slide-up shadow-glass-lg ${sheet ? 'rounded-t-3xl sm:rounded-3xl max-h-[92dvh]' : 'rounded-3xl max-h-[calc(100dvh-2.5rem)]'}`}
        style={{ background: 'var(--panel-bg)', border: '1px solid var(--glass-border)' }}
        onClick={e => e.stopPropagation()}
      >
        {icon ? (
          <div className="shrink-0 text-center px-6 pt-7 pb-2">
            <div className="text-4xl leading-none mb-3">{icon}</div>
            <h2 className="text-xl font-bold text-fg">{title}</h2>
            {subtitle && <p className="text-sm text-muted mt-1">{subtitle}</p>}
          </div>
        ) : (
          <div className="shrink-0 flex items-start justify-between px-5 pt-5 pb-3 border-b border-border">
            <div className="min-w-0">
              <h2 className="text-lg font-bold text-fg truncate">{title}</h2>
              {subtitle && <p className="text-xs text-muted mt-0.5">{subtitle}</p>}
            </div>
            <button
              onClick={onClose}
              aria-label="Fechar"
              className="w-9 h-9 shrink-0 rounded-xl glass-sm flex items-center justify-center text-muted hover:text-fg"
            >
              <X size={16} />
            </button>
          </div>
        )}
        <div className="px-5 py-4 overflow-y-auto overscroll-contain flex-1 min-h-0">{children}</div>
        {footer && <div className="shrink-0 px-5 pt-2 pb-5 safe-bottom">{footer}</div>}
      </div>
    </div>
  )
}
