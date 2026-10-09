# Locações CMR — app de celular para equipamentos locados em obra

Mesmo formato do **Efetivo CMR** (`cmr-rh.vercel.app/efetivo.html`): página única dentro do projeto Vercel `cmr-rh`, com o mesmo login do Sistema RH, as mesmas obras, o mesmo visual e o mesmo esquema offline. Fica em **`cmr-rh.vercel.app/locacoes.html`**.

## O que faz
- **Equipamentos**: filtro por obra, busca e contadores Ativos / Alertas / Devolvidos / Todos, com o somatório do filtro. Cada cartão mostra entrada, fim, dias restantes ou vencidos, renovações, retirada agendada, valor e fotos.
- **Nova locação**: equipamento, obra (lista do Sistema RH), fornecedor, período (diária/semanal/quinzenal/mensal), quantidade, entrada e fim, valor por período, outros custos, tipo de cobrança, valor manual, código e observações, mais as fotos do recebimento.
- **Renovar**: sugere fim + 1 período e mostra o acréscimo; guarda histórico e permite desfazer.
- **Devolver**: data futura agenda a retirada; hoje ou antes confirma a devolução, com o custo final e as fotos da entrega.
- **Fotos**: tiradas pela câmera, reduzidas para até 1280 px e carimbadas com tipo, equipamento e data/hora. Ficam no Vercel Blob privado e só abrem com login.
- **Alertas**: aviso N dias antes (padrão 7, ajustável em ⚙); "Avisar" gera a mensagem para o **WhatsApp**; contador no ícone do app; notificação diária ao abrir; exportação para o **Calendário** (lembretes que tocam com o app fechado).
- **Agenda**: vencimentos e retiradas por mês.
- **Valores**: total geral, ativos, devolvidos, custo mensal atual, por fornecedor, por obra e por mês de entrada; envio por WhatsApp e planilha CSV.
- **Sem sinal na obra**: abre com a última cópia, cadastra, renova, devolve e fotografa. Tudo vai para a fila e sobe sozinho quando o sinal volta.
- **Mesmo login do Efetivo**: quem já entrou no Efetivo no celular entra direto.

## Cobrança (padrão proporcional)
`(períodos cheios + dias avulsos ÷ dias do período) × valor × quantidade + outros custos`. Dias por período: diária 1, semanal 7, quinzenal 15, mensal 30. Os meses são contados pelo calendário.
- Devolvido: cobra até a data real da devolução.
- Ativo: cobra até max(hoje, fim do contrato).
- Mínimo: 1 dia.
- Exemplo: mensal de R$ 300, entrada 03/08, devolução 16/09 → 1 mês + 13 dias = R$ 430 por unidade.
- Opção por item **período cheio**: período iniciado é cobrado inteiro, e a devolução antecipada paga até o fim do contrato. Para qualquer outra regra, use o **valor total manual**.

## Arquivos (pasta `cmr-rh/`, mesma estrutura do projeto)
| Arquivo | O que é |
|---|---|
| `public/locacoes.html` | o app (HTML + CSS + JS, sem build) |
| `public/locacoes-sw.js` | service worker com escopo `/locacoes`, que não toca no Sistema RH |
| `public/locacoes.webmanifest`, `public/locacoes-icon-*.png` | instalação na tela inicial |
| `api/locacoes.js` | API: valida o mesmo token do `/api/auth`, grava em `cmr-locacoes.json` e `cmr-locacoes/fotos/` no Blob |

Nada do RH nem do Efetivo é alterado. O `@vercel/blob` já está no `package.json` do projeto, e as obras vêm do `/api/dados` (`carregar-obras`) que já existe.

## Publicar (como o Efetivo é publicado)
1. Copie os arquivos de `cmr-rh/` para a pasta do projeto `cmr-rh` no seu computador, mantendo `public/` e `api/`.
2. Nessa pasta: `vercel --prod`.
3. No celular: abra `cmr-rh.vercel.app/locacoes.html` → **Instalar** (iPhone: Compartilhar → Adicionar à Tela de Início).

Variáveis opcionais: `CMR_BLOB_ACCESS=public` se o Blob store for público (o padrão é privado, igual ao uso do `get()` no RH) e `CMR_LOCACOES_PATH` para outro nome de arquivo.

## Limites conhecidos
- Duas pessoas salvando o **mesmo item** ao mesmo tempo: vale a última gravação. Itens diferentes não se sobrescrevem (gravação condicional por ETag).
- Fotos de até 3 MB depois da compressão (na prática ficam entre 150 e 400 KB).
- Notificação no iPhone só aparece ao abrir o app. Para lembrete garantido, use o Calendário.
