# CMR Locações — controle de equipamentos locados em obra

App para celular (PWA instalável no iPhone/Android), **multiusuário**, integrado ao Supabase da plataforma CMR.

## Funcionalidades
- **Login** com o mesmo usuário da plataforma CMR. Acesso liberado para quem está ativo em `public.app_users` (`is_platform_user()`), com redefinição de senha por e-mail.
- **Sincronização em tempo real** entre todos os usuários (Supabase Realtime). Cópia local para consulta sem internet, somente leitura.
- **Cadastro**: equipamento, fornecedor, obra (sugere as obras de `public.projects` e grava `project_id` quando o nome bate), período, quantidade, entrada, fim, valor unitário por período, outros custos, valor manual, tipo de cobrança, código e observações.
- **Status e alertas**: Ativo / Em alerta (≤ N dias, configurável por aparelho) / Vencido / Devolvido; contador no ícone e notificação diária ao abrir o app.
- **Renovar** (com histórico e desfazer), **devolver** ou **agendar retirada**, **reabrir**.
- **Fotos de recebimento e entrega**: comprimidas (máx. 1600px, JPEG), com carimbo de tipo, equipamento e data/hora gravado na imagem. Ficam no bucket privado `locacoes`, acessado por URLs assinadas de 1h.
- **Auditoria**: quem cadastrou e quem alterou por último (e-mail + data).
- **Somatórios** por filtro, fornecedor, obra e mês de entrada; exportação CSV (Excel pt-BR).
- **Agenda** com exportação `.ics` (lembretes N dias antes e no dia, que disparam com o app fechado).

## Regra de cálculo
Padrão **proporcional**: `(períodos cheios + dias avulsos ÷ dias do período) × valor × quantidade + outros custos`.
Dias do período: diária 1, semanal 7, quinzenal 15, **mensal 30** (convenção comercial; os meses são contados pelo calendário).
- Devolvido: cobra até a data real da devolução, antes ou depois do fim do contrato.
- Ativo: projeção até max(hoje, fim do contrato).
- Mínimo: 1 dia.

Exemplo: mensal de R$ 300, entrada em 03/08, devolução em 16/09 → 1 mês + 13 dias = 300 + 13 × 10 = **R$ 430**.

Opção por item **período cheio**: todo período iniciado é cobrado inteiro, e a devolução antecipada paga até o fim do contrato. Para outra regra, use o **valor total manual**.

## Backend (Supabase)
Migração: `supabase/migrations/20260930000000_locacoes.sql`. É **aditiva**: cria `locacoes`, `locacao_fotos`, o bucket `locacoes`, políticas RLS/Storage via `is_platform_user()` e adiciona as tabelas ao realtime. Nenhuma tabela existente é alterada.

Para liberar um novo usuário: crie o login no Supabase Auth e cadastre o e-mail como ativo em `app_users`, pelo painel da plataforma.

Para a redefinição de senha funcionar, adicione a URL publicada em **Authentication → URL Configuration → Redirect URLs**.

## Rodar / publicar
Site estático, sem build (`vendor/` contém o supabase-js 2.117.2 embutido). Local: `python3 -m http.server 8080`.
No iPhone: Safari → Compartilhar → **Adicionar à Tela de Início**. A cada release, incremente `VERSAO` em `sw.js`.

## Limitações conhecidas
- Sem internet: somente leitura. Cadastros, fotos e alterações exigem conexão.
- iOS não permite notificação local agendada em PWA sem servidor de push: o aviso aparece ao abrir o app. Para lembrete garantido, use a exportação `.ics`.
- Concorrência: duas pessoas editando o mesmo item ao mesmo tempo → vale a última gravação.
