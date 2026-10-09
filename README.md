# CMR · Equipamentos locados em obra

PWA para celular (Next.js 14 + Tailwind) no mesmo design system do módulo de efetivo do APP-CMR-GERAL
(DM Sans, tokens `--accent`/`--c-*`, tema claro vermelho CMR e tema escuro teal).

## Funções
- Cadastro da locação: equipamento, qtd, acessórios, fornecedor/telefone, obra, contrato/NF, cobrança (diária/semanal/quinzenal/mensal), valor unitário, frete, entrada e vencimento.
- Filtros **Ativos / Alertas / Devolvidos / Todos**, filtro por obra e busca.
- **Alertas**: vence em até N dias (2–10, configurável), vencido, retirada hoje/atrasada. Badge na aba.
- **Push diário com o app fechado** (modo Supabase): Vercel Cron às 07h45 (Brasília) chama `/api/cron/alertas`, que manda a lista do que vence/venceu para cada aparelho inscrito. Tocar abre o filtro Alertas.
- **Permissões**: qualquer usuário da plataforma cadastra, renova, agenda/confirma devolução e adiciona fotos. Só **admin** (`app_users.role = 'admin'`) edita dados cadastrais, exclui locações/fotos e desfaz devolução — barrado no banco (RLS + gatilho), não só na tela.
- **Renovar**: nova data sugerida = vencimento + 1 período; histórico de renovações.
- **Devolver**: agendar retirada ou confirmar devolução (abre direto as fotos de entrega). Desfazer devolução.
- **Fotos** de recebimento e entrega (câmera ou galeria), comprimidas no aparelho para ~1600px JPEG.
- **Resumo**: custo mensal atual, gasto acumulado, previsto em aberto, ranking por obra e por fornecedor; exportação CSV para Excel.
- Ligar / WhatsApp para a locadora; backup/restauração JSON.

### Regra de custo (`src/lib/calc.ts`)
Proporcional por dia corrido, sem período mínimo: `valor do período ÷ (1 | 7 | 15 | 30) × dias` (mês comercial de 30 dias), mínimo 1 dia, arredondado em centavos.
Atraso após o vencimento entra no previsto; devolução antecipada reduz o total. A sugestão de renovação mensal soma 1 mês de calendário (31/01 → 28/02).

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

## Ativar o push (Vercel)
1. `npx web-push generate-vapid-keys` → copie as duas chaves.
2. Em *Vercel → Project → Settings → Environment Variables* crie: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY` (somente servidor), `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (`mailto:` de contato) e `CRON_SECRET` (texto aleatório longo).
3. Faça o deploy — o `vercel.json` registra o cron. Teste manual: `curl -H "Authorization: Bearer $CRON_SECRET" https://SEU-APP/api/cron/alertas`.
4. No celular: instalar na Tela de Início → Ajustes → *Notificação diária de alertas*.

## Instalar no celular
Publique (ex.: Vercel) e abra no navegador → *Adicionar à Tela de Início*. No iPhone, notificações exigem o app instalado (iOS 16.4+).
