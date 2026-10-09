import type { Config } from 'tailwindcss'

// Mesmos tokens do APP-CMR-GERAL (módulo de efetivo): cores vêm das variáveis CSS do tema.
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        accent: {
          DEFAULT: 'rgb(var(--accent-rgb) / <alpha-value>)',
          muted: 'rgb(var(--accent-rgb) / 0.15)',
        },
        white: 'rgb(var(--ink-rgb) / <alpha-value>)',
        fg: 'var(--color-fg)',
        muted: 'var(--color-muted)',
        'muted-2': 'var(--color-muted-2)',
        border: 'var(--color-border)',
        'border-strong': 'var(--color-border-strong)',
        bg: 'var(--color-bg)',
        surface: 'var(--color-surface)',
      },
      fontFamily: {
        sans: ['DM Sans', 'system-ui', 'sans-serif'],
        display: ['DM Serif Display', 'Georgia', 'serif'],
      },
      boxShadow: {
        'glass-lg': '0 8px 48px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.07)',
      },
      animation: {
        'fade-in': 'fadeIn 0.3s ease-out',
        'slide-up': 'slideUp 0.3s ease-out',
      },
      keyframes: {
        fadeIn: { from: { opacity: '0' }, to: { opacity: '1' } },
        slideUp: {
          from: { opacity: '0', transform: 'translateY(12px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
}

export default config
