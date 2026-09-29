# CMR Locações — controle de equipamentos locados em obra

App para celular (PWA, instalável no iPhone/Android, funciona offline) para controlar equipamentos locados.

## Funcionalidades
- **Cadastro**: equipamento, fornecedor, obra, período (diária/semanal/quinzenal/mensal), quantidade, entrada, fim, valor unitário por período, outros custos (frete/avaria), valor manual opcional, código e observações.
- **Status e alertas**: Ativo / Em alerta (≤ N dias, configurável) / Vencido / Devolvido; contador no ícone e na aba; notificação diária ao abrir o app.
- **Renovar**: sugere fim + 1 período, mostra o acréscimo de custo e guarda o histórico (com desfazer).
- **Devolver**: agendar retirada (data futura) ou confirmar devolução (hoje/passado) com o custo final calculado.
- **Fotos de recebimento e entrega**: câmera direto, com compressão (máx. 1600px) e carimbo de data/hora e tipo gravado na imagem.
- **Somatórios**: por filtro, por fornecedor, por obra e por mês de entrada; exportação CSV (Excel pt-BR).
- **Agenda**: vencimentos e retiradas; exporta `.ics` para o Calendário do celular com lembretes que disparam mesmo com o app fechado.
- **Backup**: exporta/restaura JSON com fotos.

## Regra de cálculo
`períodos cobrados × valor unitário × quantidade + outros custos`. Período iniciado = período cheio. Mensal usa mês civil.
Devolução antes do fim → cobra até o fim do contrato; depois do fim → até a data real. Ativos: projetado até max(hoje, fim).
Contrato com regra diferente (pró-rata, franquia) → usar "valor total manual".

## Rodar / publicar
Site estático sem build. Local: `python3 -m http.server 8080` e abrir `http://localhost:8080`.
Publicação: qualquer hospedagem HTTPS estática (GitHub Pages, Vercel, Netlify). No iPhone: Safari → Compartilhar → **Adicionar à Tela de Início**.
Ao lançar uma nova versão, incremente `VERSAO` em `sw.js`.

## Limitações conhecidas
- Dados ficam **somente no aparelho** (IndexedDB). Sem sincronização entre celulares/usuários — use backup. Multiusuário exige backend (ex.: Supabase).
- iOS não permite notificação local agendada em PWA sem servidor de push: o aviso aparece ao abrir o app; para lembrete garantido, use a exportação `.ics`.
