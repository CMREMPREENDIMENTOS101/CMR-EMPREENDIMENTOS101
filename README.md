# CMR · Equipamentos locados em obra

PWA para celular (Next.js 14 + Tailwind) no mesmo design system do módulo de efetivo do APP-CMR-GERAL
(DM Sans, tokens `--accent`/`--c-*`, tema claro vermelho CMR e tema escuro teal).

## Funções
- Cadastro da locação: equipamento, qtd, acessórios, fornecedor/telefone, obra, contrato/NF, cobrança (diária/semanal/quinzenal/mensal), valor unitário, frete, entrada e vencimento.
- Filtros **Ativos / Alertas / Devolvidos / Todos**, filtro por obra e busca.
- **Alertas**: vence em até N dias (2–10, configurável), vencido, retirada hoje/atrasada. Badge na aba e notificação local 1×/dia ao abrir o app.
- **Renovar**: nova data sugerida = vencimento + 1 período; histórico de renovações.
- **Devolver**: agendar retirada ou confirmar devolução (abre direto as fotos de entrega). Desfazer devolução.
- **Fotos** de recebimento e entrega (câmera ou galeria), comprimidas no aparelho para ~1600px JPEG.
- **Resumo**: custo mensal atual, gasto acumulado, previsto em aberto, ranking por obra e por fornecedor; exportação CSV para Excel.
- Ligar / WhatsApp para a locadora; backup/restauração JSON.

### Regra de custo (`src/lib/calc.ts`)
Período iniciado = período cobrado, mínimo 1. Atraso após o vencimento entra no previsto.
Devolução antecipada cobra só os períodos usados. Mensal soma meses de calendário (31/01 + 1 mês = 28/02).

## Rodar
```bash
npm install
npm run dev        # http://localhost:3000
npm run build && npm start
```

## Armazenamento
- **Sem variáveis de ambiente**: dados e fotos ficam no IndexedDB do aparelho (offline, sem servidor, não compartilha entre aparelhos — faça backup).
- **Com Supabase**: copie `.env.example` para `.env.local`, preencha URL/anon key e rode `supabase/schema.sql`.
  O SQL assume o mesmo projeto do APP-CMR-GERAL (usa `public.is_platform_user()` e o login do Supabase Auth). Fotos vão para o bucket privado `equip-fotos` (URLs assinadas).

## Instalar no celular
Publique (ex.: Vercel) e abra no navegador → *Adicionar à Tela de Início*. No iPhone, notificações exigem o app instalado (iOS 16.4+).
