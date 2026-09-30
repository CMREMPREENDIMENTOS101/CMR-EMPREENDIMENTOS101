'use strict';

/* =====================================================================
 * CMR Locações — controle de equipamentos locados em obra
 * PWA multiusuário. Dados no Supabase (tabelas locacoes / locacao_fotos,
 * bucket privado 'locacoes'), acesso via public.is_platform_user().
 * Snapshot local (localStorage) permite consulta sem conexão.
 * ===================================================================== */

// ---------------------------------------------------------------- datas
// Datas são sempre strings 'YYYY-MM-DD' em horário local; nunca UTC.
const pad = (n) => String(n).padStart(2, '0');
const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseISO = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const hoje = () => toISO(new Date());
const diffDias = (a, b) => Math.round((parseISO(b) - parseISO(a)) / 86400000); // b - a
const maxISO = (a, b) => (!a ? b : !b ? a : a > b ? a : b);
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const fmtCurta = (s) => { if (!s) return '—'; const d = parseISO(s); return `${pad(d.getDate())} de ${MESES[d.getMonth()]}`; };
const fmtLonga = (s) => { if (!s) return '—'; const d = parseISO(s); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`; };
const fmtCurtaAno = (s) => {
  if (!s) return '—';
  return parseISO(s).getFullYear() === new Date().getFullYear() ? fmtCurta(s) : `${fmtCurta(s)} ${parseISO(s).getFullYear()}`;
};

const PERIODOS = {
  diaria: { nome: 'Diária', dias: 1 },
  semanal: { nome: 'Semanal', dias: 7 },
  quinzenal: { nome: 'Quinzenal', dias: 15 },
  mensal: { nome: 'Mensal', dias: null }, // mês civil
};

/** Soma n períodos a uma data. Mensal usa mês civil (31/jan + 1 = 28/fev). */
function addPeriodo(iso, periodo, n = 1) {
  const d = parseISO(iso);
  if (periodo === 'mensal') {
    const dia = d.getDate();
    const alvo = new Date(d.getFullYear(), d.getMonth() + n, 1);
    const ultimo = new Date(alvo.getFullYear(), alvo.getMonth() + 1, 0).getDate();
    alvo.setDate(Math.min(dia, ultimo));
    return toISO(alvo);
  }
  d.setDate(d.getDate() + PERIODOS[periodo].dias * n);
  return toISO(d);
}

/** Quantidade de períodos cobrados entre entrada e ref (período iniciado = período cobrado). */
function contarPeriodos(entrada, ref, periodo) {
  if (!entrada || !ref || ref <= entrada) return 1;
  if (periodo !== 'mensal') return Math.max(1, Math.ceil(diffDias(entrada, ref) / PERIODOS[periodo].dias));
  let n = 0;
  while (addPeriodo(entrada, periodo, n) < ref) n++;
  return Math.max(1, n);
}

// ---------------------------------------------------------------- dinheiro
const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const money = (v) => BRL.format(Number(v) || 0);
/** Aceita "1.234,56", "1234.56", "1234,5". */
function parseMoney(s) {
  if (typeof s === 'number') return s;
  s = String(s || '').replace(/[^\d,.-]/g, '');
  if (!s) return 0;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const v = parseFloat(s);
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : 0;
}
const moneyInput = (v) => (v ? Number(v).toFixed(2).replace('.', ',') : '');

// ---------------------------------------------------------------- regras de negócio
function statusDe(e) {
  if (e.status === 'devolvido') return { key: 'devolvido', dias: null };
  const dias = diffDias(hoje(), e.fim);
  if (dias < 0) return { key: 'vencido', dias };
  if (dias <= state.cfg.alertaDias) return { key: 'alerta', dias };
  return { key: 'ok', dias };
}
const emAlerta = (e) => { const k = statusDe(e).key; return k === 'alerta' || k === 'vencido'; };

const ROTULO_PER = {
  diaria: ['diária', 'diárias'], semanal: ['semana', 'semanas'], quinzenal: ['quinzena', 'quinzenas'], mensal: ['mês', 'meses'],
};
const plural = (n, [um, varios]) => `${n} ${n === 1 ? um : varios}`;
const round2 = (v) => Math.round(v * 100) / 100;

/**
 * Períodos cobrados.
 *  - proporcional (padrão): períodos cheios + dias avulsos × (valor ÷ dias do período; mensal ÷ 30).
 *    Devolvido: cobra até a data real da devolução (antes ou depois do fim).
 *    Ativo: projeta até max(hoje, fim do contrato). Mínimo: 1 dia.
 *  - cheio: período iniciado = período cheio; devolução antecipada paga até o fim do contrato.
 */
function calcPeriodos(e) {
  const hj = hoje();
  if (e.cobranca === 'cheio') {
    const ref = e.status === 'devolvido' ? maxISO(e.devolucao, e.fim) : maxISO(hj, e.fim);
    const n = contarPeriodos(e.entrada, ref, e.periodo);
    return { fator: n, texto: plural(n, ROTULO_PER[e.periodo]) };
  }
  const ref = e.status === 'devolvido' ? e.devolucao : maxISO(hj, e.fim);
  let n = 0;
  while (addPeriodo(e.entrada, e.periodo, n + 1) <= ref) n++;
  let dias = diffDias(addPeriodo(e.entrada, e.periodo, n), ref);
  if (n === 0 && dias <= 0) dias = 1;
  const base = PERIODOS[e.periodo].dias || 30;
  const partes = [n && plural(n, ROTULO_PER[e.periodo]), dias && plural(dias, ['dia', 'dias'])].filter(Boolean);
  return { fator: n + dias / base, texto: partes.join(' + ') };
}
function custo(e) {
  const p = calcPeriodos(e);
  const manual = e.valorManual != null && e.valorManual !== '';
  const aluguel = manual ? Number(e.valorManual) : round2(p.fator * (Number(e.valor) || 0) * (Number(e.qtd) || 1));
  const extras = Number(e.extras) || 0;
  return { periodos: p.texto, aluguel, extras, total: round2(aluguel + extras), manual };
}

// ---------------------------------------------------------------- Supabase
const SUPABASE_URL = 'https://ncsmcopvjfqfeadkzkuz.supabase.co';
const SUPABASE_KEY = 'sb_publishable_hzxs0yzFqh6ROaFat7uiHg_qXAt7hAk'; // chave pública; o acesso é protegido por RLS
const BUCKET = 'locacoes';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
  const r = (Math.random() * 16) | 0; return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
}));

const numOuNulo = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
function fromRow(r) {
  return {
    id: r.id, nome: r.nome, fornecedor: r.fornecedor || '', obra: r.obra || '', projectId: r.project_id,
    periodo: r.periodo, cobranca: r.cobranca || 'proporcional', qtd: r.qtd, entrada: r.entrada, fim: r.fim,
    valor: Number(r.valor) || 0, extras: Number(r.extras) || 0, valorManual: r.valor_manual == null ? '' : Number(r.valor_manual),
    codigo: r.codigo || '', obs: r.obs || '', status: r.status, devolucao: r.devolucao, retirada: r.retirada,
    renovacoes: r.renovacoes || [], criadoEm: r.criado_em, criadoPorEmail: r.criado_por_email,
    atualizadoEm: r.atualizado_em, atualizadoPorEmail: r.atualizado_por_email,
  };
}
function toRow(e) {
  const proj = state.projetos.find((p) => p.name.trim().toLowerCase() === (e.obra || '').trim().toLowerCase());
  return {
    id: e.id, nome: e.nome, fornecedor: e.fornecedor || null, obra: e.obra || null, project_id: proj ? proj.id : null,
    periodo: e.periodo, cobranca: e.cobranca || 'proporcional', qtd: e.qtd || 1, entrada: e.entrada, fim: e.fim,
    valor: Number(e.valor) || 0, extras: Number(e.extras) || 0, valor_manual: numOuNulo(e.valorManual),
    codigo: e.codigo || null, obs: e.obs || null, status: e.status, devolucao: e.devolucao || null,
    retirada: e.retirada || null, renovacoes: e.renovacoes || [],
  };
}

// ---------------------------------------------------------------- estado
const CFG_PADRAO = { alertaDias: 7, notificar: false, ultimaNotif: null };
const LS_CFG = 'cmr-locacoes-cfg';
const LS_SNAP = 'cmr-locacoes-snapshot';
const lerLS = (k, def) => { try { return JSON.parse(localStorage.getItem(k)) ?? def; } catch (_) { return def; } };
const gravarLS = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* cota cheia ou modo privado */ } };

const state = {
  usuario: null,       // e-mail logado
  acesso: null,        // true | false | null (verificando)
  offline: false,
  equip: [],
  fotos: [],           // metadados das fotos (locacao_fotos)
  projetos: [],        // obras da plataforma (public.projects)
  cfg: { ...CFG_PADRAO, ...lerLS(LS_CFG, {}) },
  view: 'inicio',
  filtro: 'ativos',
  busca: '',
  obra: '',
  relObra: '',
  relFornecedor: '',
};
function salvarCfg() { gravarLS(LS_CFG, state.cfg); }
function salvarSnapshot() { gravarLS(LS_SNAP, { em: new Date().toISOString(), usuario: state.usuario, equip: state.equip, fotos: state.fotos, projetos: state.projetos }); }

function erroRede(err) {
  console.error(err);
  const msg = String(err?.message || err);
  if (!navigator.onLine || /fetch|network/i.test(msg)) return 'Sem conexão. Tente novamente quando tiver internet.';
  if (/row-level security|permission|JWT|401|403/i.test(msg)) return 'Sem permissão. Verifique se seu usuário está ativo.';
  return 'Erro ao salvar: ' + msg;
}

async function carregarDados() {
  const [l, f, p] = await Promise.all([
    sb.from('locacoes').select('*').order('fim'),
    sb.from('locacao_fotos').select('*').order('criado_em'),
    sb.from('projects').select('id,name,status').order('name'),
  ]);
  if (l.error) throw l.error;
  if (f.error) throw f.error;
  state.equip = l.data.map(fromRow);
  state.fotos = f.data;
  state.projetos = p.error ? [] : p.data.filter((x) => x.name);
  state.offline = false;
  salvarSnapshot();
}

/** Grava (insert/update) e devolve a versão do servidor. Não altera o estado se falhar. */
async function salvarEquip(e, novo = false) {
  const row = toRow(e);
  const q = novo ? sb.from('locacoes').insert(row) : sb.from('locacoes').update(row).eq('id', e.id);
  const { data, error } = await q.select().single();
  if (error) throw error;
  mesclarEquip(fromRow(data));
  return state.equip.find((x) => x.id === data.id);
}
function mesclarEquip(e) {
  const i = state.equip.findIndex((x) => x.id === e.id);
  if (i >= 0) state.equip[i] = e; else state.equip.push(e);
  salvarSnapshot();
}
/** Executa uma escrita, mostrando erro amigável. Retorna true se deu certo. */
async function tentar(fn) {
  if (state.offline && !navigator.onLine) { toast('Sem conexão: modo somente leitura.'); return false; }
  try { await fn(); return true; } catch (err) { toast(erroRede(err)); return false; }
}

// ---------------------------------------------------------------- fotos
const fotosDe = (equipId, tipo) => state.fotos.filter((f) => f.locacao_id === equipId && (!tipo || f.tipo === tipo));
const urlCache = new Map(); // path -> { url, exp }
async function urlsAssinadas(paths) {
  const agora = Date.now();
  const faltam = [...new Set(paths)].filter((p) => !(urlCache.get(p)?.exp > agora));
  if (faltam.length && !state.offline) {
    const { data, error } = await sb.storage.from(BUCKET).createSignedUrls(faltam, 3600);
    if (!error) for (const d of data) if (d.signedUrl) urlCache.set(d.path, { url: d.signedUrl, exp: agora + 3500 * 1000 });
  }
  return Object.fromEntries(paths.map((p) => [p, urlCache.get(p)?.url || '']));
}

async function enviarFoto(equipId, tipo, blob) {
  const path = `${equipId}/${uid()}.jpg`;
  const up = await sb.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: false });
  if (up.error) throw up.error;
  const { data, error } = await sb.from('locacao_fotos').insert({ locacao_id: equipId, tipo, path }).select().single();
  if (error) { await sb.storage.from(BUCKET).remove([path]); throw error; }
  urlCache.set(path, { url: URL.createObjectURL(blob), exp: Date.now() + 3500 * 1000 });
  if (!state.fotos.some((f) => f.id === data.id)) state.fotos.push(data);
}
async function removerFoto(f) {
  const { error } = await sb.from('locacao_fotos').delete().eq('id', f.id);
  if (error) throw error;
  await sb.storage.from(BUCKET).remove([f.path]);
  state.fotos = state.fotos.filter((x) => x.id !== f.id);
}

/** Redimensiona para no máx. 1600px, grava carimbo de data/hora e tipo na imagem (evidência). */
async function processarFoto(file, legenda) {
  const img = await carregarImagem(file);
  const MAX = 1600;
  const esc = Math.min(1, MAX / Math.max(img.width, img.height));
  const w = Math.round(img.width * esc), h = Math.round(img.height * esc);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0, w, h);
  const agora = new Date();
  const txt = `${legenda} · ${pad(agora.getDate())}/${pad(agora.getMonth() + 1)}/${agora.getFullYear()} ${pad(agora.getHours())}:${pad(agora.getMinutes())}`;
  const fs = Math.max(16, Math.round(w / 40));
  g.font = `600 ${fs}px sans-serif`;
  const tw = g.measureText(txt).width;
  g.fillStyle = 'rgba(0,0,0,.55)';
  g.fillRect(0, h - fs * 2, Math.min(w, tw + fs * 1.5), fs * 2);
  g.fillStyle = '#fff';
  g.fillText(txt, fs * 0.75, h - fs * 0.65);
  if (img.close) img.close();
  return new Promise((res) => c.toBlob((b) => res(b), 'image/jpeg', 0.75));
}
async function carregarImagem(file) {
  if (window.createImageBitmap) {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (_) { /* fallback */ }
  }
  return new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = URL.createObjectURL(file);
  });
}
/** Processa arquivos da câmera em JPEG com carimbo. Retorna os blobs. */
async function processarArquivos(nome, tipo, files) {
  const legenda = `${tipo === 'recebimento' ? 'RECEBIMENTO' : 'ENTREGA'} · ${nome}`;
  const out = [];
  for (const f of files) {
    try { out.push(await processarFoto(f, legenda)); } catch (err) { console.error(err); toast('Não foi possível processar uma das fotos'); }
  }
  return out;
}

// ---------------------------------------------------------------- helpers de UI
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let toastT;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('show'), 2600);
}
const ICON = {
  edit: '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13 7l4 4"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  gear: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  share: '<svg viewBox="0 0 24 24"><path d="M12 3v12M7 8l5-5 5 5"/><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/></svg>',
};

/** Compartilha (iOS: menu de compartilhar/salvar em Arquivos) ou baixa um arquivo. */
async function entregarArquivo(nome, conteudo, mime) {
  const blob = conteudo instanceof Blob ? conteudo : new Blob([conteudo], { type: mime });
  const file = new File([blob], nome, { type: mime });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: nome }); return; } catch (err) { if (err.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

// ---------------------------------------------------------------- modal
let modalFechar = null;
function abrirModal(html, { center = false, onMount, onClose } = {}) {
  fecharModal();
  const root = $('#modal-root');
  root.innerHTML = `<div class="overlay ${center ? 'center' : ''}"><div class="sheet" role="dialog" aria-modal="true">${center ? '' : '<div class="grip"></div>'}${html}</div></div>`;
  const ov = $('.overlay', root);
  ov.addEventListener('click', (ev) => { if (ev.target === ov) fecharModal(); });
  modalFechar = onClose || null;
  document.body.style.overflow = 'hidden';
  if (onMount) onMount($('.sheet', root));
}
function fecharModal() {
  const root = $('#modal-root');
  if (!root.innerHTML) return;
  root.innerHTML = '';
  document.body.style.overflow = '';
  const f = modalFechar; modalFechar = null;
  if (f) f();
}
function confirmar(titulo, texto, rotuloOk = 'Confirmar', perigo = false) {
  return new Promise((res) => {
    abrirModal(`
      <div class="center-head"><h2>${esc(titulo)}</h2><p>${esc(texto)}</p></div>
      <div class="sheet-actions two">
        <button class="btn outline" data-r="0">Cancelar</button>
        <button class="btn ${perigo ? 'danger' : 'primary'}" data-r="1">${esc(rotuloOk)}</button>
      </div>`, {
      center: true,
      onClose: () => res(false),
      onMount: (s) => $$('[data-r]', s).forEach((b) => b.addEventListener('click', () => {
        modalFechar = null; fecharModal(); res(b.dataset.r === '1');
      })),
    });
  });
}

// ---------------------------------------------------------------- render
function render() {
  const logado = state.usuario && state.acesso;
  document.body.classList.toggle('sem-sessao', !logado);
  const v = $('#view');
  if (!state.usuario) { v.innerHTML = viewLogin(); return; }
  if (state.acesso === null) { v.innerHTML = '<div class="empty"><div class="big">⏳</div><p>Carregando…</p></div>'; return; }
  if (!state.acesso) { v.innerHTML = viewSemAcesso(); return; }

  $$('#tabbar [data-nav]').forEach((b) => b.classList.toggle('on', b.dataset.nav === state.view));
  const nAlert = state.equip.filter((e) => e.status !== 'devolvido' && emAlerta(e)).length;
  const eqBtn = $('#tabbar [data-nav="equipamentos"]');
  $('.dot', eqBtn)?.remove();
  if (nAlert) eqBtn.insertAdjacentHTML('beforeend', `<i class="dot">${nAlert}</i>`);
  if (navigator.setAppBadge) (nAlert ? navigator.setAppBadge(nAlert) : navigator.clearAppBadge()).catch(() => {});

  const offline = state.offline ? `<div class="banner warn small">📴 Sem conexão — mostrando a última cópia salva neste aparelho (somente leitura).</div>` : '';
  v.innerHTML = offline + ({ inicio: viewInicio, agenda: viewAgenda, relatorios: viewRelatorios, equipamentos: viewEquipamentos }[state.view])();
  carregarThumbs(v);
}

// Re-render agrupado (realtime pode disparar vários eventos seguidos); preserva o foco da busca.
let renderT;
function agendarRender() {
  clearTimeout(renderT);
  renderT = setTimeout(() => {
    const ativo = document.activeElement?.id === 'busca' ? $('#busca').selectionStart : null;
    render();
    if (ativo !== null && $('#busca')) { $('#busca').focus(); $('#busca').setSelectionRange(ativo, ativo); }
  }, 150);
}

async function carregarThumbs(root) {
  const alvos = $$('[data-thumbs]', root).map((el) => ({ el, fotos: fotosDe(el.dataset.thumbs).slice(-4) })).filter((x) => x.fotos.length);
  if (!alvos.length) return;
  const urls = await urlsAssinadas(alvos.flatMap((x) => x.fotos.map((f) => f.path)));
  for (const { el, fotos } of alvos) {
    el.innerHTML = fotos.filter((f) => urls[f.path]).map((f) => `<img src="${esc(urls[f.path])}" alt="" loading="lazy">`).join('');
    el.hidden = !el.innerHTML;
  }
}

function viewLogin() {
  return `
  <div class="login">
    <img src="icons/icon.svg" alt="" width="72" height="72">
    <h1>CMR Locações</h1>
    <p class="muted">Controle de equipamentos locados em obra</p>
    <form id="form-login" autocomplete="on">
      <div class="field"><label>E-mail</label><input name="email" type="email" autocomplete="username" required inputmode="email"></div>
      <div class="field"><label>Senha</label><input name="senha" type="password" autocomplete="current-password" required></div>
      <button class="btn primary block" type="submit">Entrar</button>
      <button class="btn ghost block mt" type="button" data-esqueci>Esqueci a senha</button>
    </form>
    <p class="muted small">Use o mesmo login da plataforma CMR. Sem acesso? Peça ao administrador.</p>
  </div>`;
}
function viewSemAcesso() {
  return `
  <div class="empty">
    <div class="big">🔒</div>
    <p><b>${esc(state.usuario)}</b> não tem acesso ao controle de locações.</p>
    <p class="small">Peça ao administrador para ativar seu usuário na plataforma CMR.</p>
    <button class="btn outline" data-sair>Sair</button>
  </div>`;
}

const ativos = () => state.equip.filter((e) => e.status !== 'devolvido');
const ordenarPorFim = (a, b) => (a.fim < b.fim ? -1 : a.fim > b.fim ? 1 : a.nome.localeCompare(b.nome));
const obras = () => [...new Set(state.equip.map((e) => e.obra).filter(Boolean))].sort((a, b) => a.localeCompare(b));
const obrasSugestao = () => [...new Set([...state.projetos.filter((p) => !/conclu|cancel|finaliz/i.test(p.status || '')).map((p) => p.name), ...obras()])].sort((a, b) => a.localeCompare(b));
const fornecedores = () => [...new Set(state.equip.map((e) => e.fornecedor).filter(Boolean))].sort((a, b) => a.localeCompare(b));

function cardEquip(e) {
  const st = statusDe(e);
  const c = custo(e);
  const nRen = (e.renovacoes || []).length;
  let chipsFim;
  if (st.key === 'devolvido') {
    chipsFim = `<span class="chip">Até ${fmtCurtaAno(e.fim)}</span><span class="chip muted">Devolvido ${fmtCurtaAno(e.devolucao)}</span>`;
  } else {
    chipsFim = `<span class="chip ${st.key === 'ok' ? '' : st.key === 'alerta' ? 'warn' : 'danger'}">Até ${fmtCurtaAno(e.fim)}</span>`;
  }
  let restante = '';
  if (st.key === 'vencido') restante = `<span class="chip danger">${Math.abs(st.dias)}d vencido</span>`;
  else if (st.key === 'alerta') restante = `<span class="chip ${st.dias <= 2 ? 'danger' : 'warn'}">${st.dias === 0 ? 'vence hoje' : st.dias + 'd restantes'}</span>`;
  else if (st.key === 'ok') restante = `<span class="chip ok">${st.dias}d restantes</span>`;
  const badge = {
    devolvido: '<span class="badge">DEVOLV.</span>',
    vencido: '<span class="badge vencido">⚠ VENCIDO</span>',
    alerta: '<span class="badge alerta">⚠ ALERTA</span>',
    ok: '<span class="badge ok">ATIVO</span>',
  }[st.key];
  const obs = [e.codigo && `Código ${e.codigo}`, e.obs].filter(Boolean).join(' · ');
  return `
  <article class="card s-${st.key}" data-open="${e.id}">
    <div class="card-top">
      <h3>${esc(e.nome)}${Number(e.qtd) > 1 ? ` <span class="muted small">×${e.qtd}</span>` : ''}</h3>
      <button class="icon-btn" data-edit="${e.id}" aria-label="Editar">${ICON.edit}</button>
    </div>
    <div class="meta">🏢 ${esc(e.fornecedor || 'Sem fornecedor')} · ${PERIODOS[e.periodo].nome}${e.obra ? ` · 🏗️ ${esc(e.obra)}` : ''}</div>
    <div class="chips"><span class="chip">Entrada ${fmtCurtaAno(e.entrada)}</span>${chipsFim}</div>
    <div class="chips">
      ${restante}
      ${nRen ? `<span class="chip">🔄 ${nRen}x renovado</span>` : ''}
      ${e.retirada && st.key !== 'devolvido' ? `<span class="chip warn">📅 Retirada ${fmtCurta(e.retirada)}</span>` : ''}
      <span class="chip money">${money(c.total)}</span>
      ${badge}
    </div>
    ${obs ? `<div class="note">${esc(obs)}</div>` : ''}
    <div class="thumbs" data-thumbs="${e.id}" hidden></div>
    ${st.key !== 'devolvido' ? `
    <div class="card-actions">
      <button class="btn primary" data-renovar="${e.id}">🔄 Renovar</button>
      <button class="btn" data-devolver="${e.id}">📦 Devolver</button>
    </div>` : ''}
  </article>`;
}

function viewEquipamentos() {
  const lista = state.equip.filter((e) => (!state.obra || e.obra === state.obra));
  const cont = {
    ativos: lista.filter((e) => e.status !== 'devolvido').length,
    alertas: lista.filter((e) => e.status !== 'devolvido' && emAlerta(e)).length,
    devolvidos: lista.filter((e) => e.status === 'devolvido').length,
    todos: lista.length,
  };
  let itens = {
    ativos: lista.filter((e) => e.status !== 'devolvido'),
    alertas: lista.filter((e) => e.status !== 'devolvido' && emAlerta(e)),
    devolvidos: lista.filter((e) => e.status === 'devolvido'),
    todos: lista,
  }[state.filtro];
  const q = state.busca.trim().toLowerCase();
  if (q) itens = itens.filter((e) => [e.nome, e.fornecedor, e.obra, e.codigo, e.obs].some((x) => (x || '').toLowerCase().includes(q)));
  itens = state.filtro === 'devolvidos'
    ? [...itens].sort((a, b) => (b.devolucao || '').localeCompare(a.devolucao || ''))
    : [...itens].sort((a, b) => (a.status === 'devolvido') - (b.status === 'devolvido') || ordenarPorFim(a, b));
  const soma = itens.reduce((s, e) => s + custo(e).total, 0);
  const tab = (k, rot) => `<button data-filtro="${k}" class="${state.filtro === k ? 'on' : ''} ${k === 'alertas' ? 'alert' : ''}"><b>${cont[k]}</b> ${rot}</button>`;
  return `
  <header class="head">
    <div><div class="sub">${cont.alertas ? `⚠ ${cont.alertas} em alerta` : 'Locações'}</div><h1>Equipamentos</h1></div>
    <button class="btn primary sm" data-novo>+ Novo</button>
  </header>
  <div class="seg">${tab('ativos', 'Ativos')}${tab('alertas', 'Alertas')}${tab('devolvidos', 'Devolvidos')}${tab('todos', 'Todos')}</div>
  <div class="search">
    <input type="search" id="busca" placeholder="Buscar equipamento, código…" value="${esc(state.busca)}">
    ${obras().length ? `<select id="obra-filtro"><option value="">Todas as obras</option>${obras().map((o) => `<option ${o === state.obra ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>` : ''}
  </div>
  ${itens.length ? `<div class="total-box"><div><small>${itens.length} item(ns) listados</small>Somatório</div><b>${money(soma)}</b></div>` : ''}
  ${itens.map(cardEquip).join('') || `<div class="empty"><div class="big">📦</div><p>${state.equip.length ? 'Nada por aqui neste filtro.' : 'Nenhum equipamento cadastrado ainda.'}</p>${state.equip.length ? '' : '<button class="btn primary" data-novo>+ Cadastrar o primeiro</button>'}</div>`}`;
}

function viewInicio() {
  const at = ativos();
  const venc = at.filter((e) => statusDe(e).key === 'vencido');
  const alert = at.filter((e) => statusDe(e).key === 'alerta');
  const compromisso = at.reduce((s, e) => s + custo(e).total, 0);
  const totalGeral = state.equip.reduce((s, e) => s + custo(e).total, 0);
  // custo mensal equivalente dos ativos (normaliza cada período para 30 dias)
  const mensal = at.reduce((s, e) => {
    const dias = PERIODOS[e.periodo].dias || 30;
    return s + (Number(e.valor) || 0) * (Number(e.qtd) || 1) * (30 / dias);
  }, 0);
  const urgentes = [...venc, ...alert].sort(ordenarPorFim);
  const retiradas = at.filter((e) => e.retirada).sort((a, b) => a.retirada.localeCompare(b.retirada));
  const bannerNotif = 'Notification' in window && Notification.permission === 'default' && !state.cfg.notificar
    ? `<div class="banner info">🔔 Ative os avisos de vencimento<button class="btn sm primary" data-ativar-notif>Ativar</button></div>` : '';
  return `
  <header class="head">
    <div><div class="sub">CMR Empreendimentos</div><h1>Locações</h1></div>
    <div class="head-actions">
      <button class="icon-btn" data-ajustes aria-label="Ajustes">${ICON.gear}</button>
      <button class="icon-btn" data-novo aria-label="Novo">${ICON.plus}</button>
    </div>
  </header>
  ${bannerNotif}
  <div class="kpis">
    <button class="kpi" data-goto="ativos"><div class="l">Ativos</div><div class="v">${at.length}</div></button>
    <button class="kpi ${urgentes.length ? 'warn' : ''}" data-goto="alertas"><div class="l">Em alerta (≤${state.cfg.alertaDias}d)</div><div class="v">${alert.length}</div></button>
    <button class="kpi ${venc.length ? 'danger' : ''}" data-goto="alertas"><div class="l">Vencidos</div><div class="v">${venc.length}</div></button>
    <div class="kpi"><div class="l">Custo mensal atual</div><div class="v sm">${money(mensal)}</div></div>
    <div class="kpi wide"><div class="l">Compromisso dos ativos (até o fim dos contratos)</div><div class="v">${money(compromisso)}</div></div>
    <button class="kpi wide" data-nav-to="relatorios"><div class="l">Total geral (ativos + devolvidos) →</div><div class="v sm">${money(totalGeral)}</div></button>
  </div>
  <div class="sec-title">Precisam de atenção</div>
  ${urgentes.length ? urgentes.map(cardEquip).join('') : '<div class="row-list"><div class="row"><div class="grow muted">✅ Nenhum vencimento nos próximos ' + state.cfg.alertaDias + ' dias.</div></div></div>'}
  ${retiradas.length ? `<div class="sec-title">Retiradas agendadas</div><div class="row-list">${retiradas.map((e) => linhaData(e, e.retirada, 'Retirada agendada')).join('')}</div>` : ''}`;
}

function linhaData(e, data, rotulo) {
  const d = parseISO(data);
  const dias = diffDias(hoje(), data);
  const cls = dias < 0 ? 'danger' : dias <= state.cfg.alertaDias ? 'warn' : '';
  const quando = dias < 0 ? `${Math.abs(dias)}d atrás` : dias === 0 ? 'hoje' : dias === 1 ? 'amanhã' : `em ${dias}d`;
  return `<button class="row" data-open="${e.id}">
    <div class="date-box ${cls}"><b>${pad(d.getDate())}</b><span>${MESES[d.getMonth()]}</span></div>
    <div class="grow"><div class="t">${esc(e.nome)}</div><div class="s">${rotulo} · ${esc(e.fornecedor || '')}${e.obra ? ' · ' + esc(e.obra) : ''}</div></div>
    <div class="r">${quando}</div>
  </button>`;
}

function viewAgenda() {
  const eventos = [];
  for (const e of ativos()) {
    eventos.push({ e, data: e.fim, rot: 'Vencimento' });
    if (e.retirada) eventos.push({ e, data: e.retirada, rot: 'Retirada agendada' });
  }
  eventos.sort((a, b) => a.data.localeCompare(b.data));
  const grupos = new Map();
  for (const ev of eventos) {
    const d = parseISO(ev.data);
    const dias = diffDias(hoje(), ev.data);
    const k = dias < 0 ? 'Vencidos' : `${['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'][d.getMonth()]} ${d.getFullYear()}`;
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(ev);
  }
  return `
  <header class="head">
    <div><div class="sub">Próximos eventos</div><h1>Agenda</h1></div>
    ${eventos.length ? `<button class="btn sm outline" data-ics-todos>📅 Exportar</button>` : ''}
  </header>
  <div class="banner info small">Toque em “Exportar” para enviar todos os vencimentos ao Calendário do celular com lembretes ${state.cfg.alertaDias} dias antes e no dia — funciona mesmo com o app fechado.</div>
  ${[...grupos].map(([k, evs]) => `<div class="sec-title">${k}</div><div class="row-list">${evs.map((ev) => linhaData(ev.e, ev.data, ev.rot)).join('')}</div>`).join('')
    || '<div class="empty"><div class="big">📅</div><p>Nenhum vencimento pendente.</p></div>'}`;
}

function viewRelatorios() {
  let lista = state.equip;
  if (state.relObra) lista = lista.filter((e) => e.obra === state.relObra);
  if (state.relFornecedor) lista = lista.filter((e) => e.fornecedor === state.relFornecedor);
  const tot = (arr) => arr.reduce((s, e) => s + custo(e).total, 0);
  const at = lista.filter((e) => e.status !== 'devolvido');
  const dv = lista.filter((e) => e.status === 'devolvido');
  const extras = lista.reduce((s, e) => s + (Number(e.extras) || 0), 0);
  const geral = tot(lista);
  const agrupar = (campo, vazio) => {
    const m = new Map();
    for (const e of lista) {
      const k = e[campo] || vazio;
      const g = m.get(k) || { total: 0, n: 0, ativos: 0 };
      g.total += custo(e).total; g.n++; if (e.status !== 'devolvido') g.ativos++;
      m.set(k, g);
    }
    return [...m].sort((a, b) => b[1].total - a[1].total);
  };
  const bloco = (titulo, grupos) => {
    const max = Math.max(1, ...grupos.map(([, g]) => g.total));
    return grupos.length ? `<div class="sec-title">${titulo}</div><div class="row-list">${grupos.map(([k, g]) => `
      <div class="row"><div class="grow"><div class="t">${esc(k)}</div><div class="s">${g.n} locação(ões) · ${g.ativos} ativa(s)</div>
      <div class="bar"><i style="width:${(g.total / max) * 100}%"></i></div></div><div class="r">${money(g.total)}<small>${geral ? Math.round((g.total / geral) * 100) : 0}%</small></div></div>`).join('')}</div>` : '';
  };
  // por mês de entrada
  const porMes = new Map();
  for (const e of lista) {
    const k = e.entrada.slice(0, 7);
    porMes.set(k, (porMes.get(k) || 0) + custo(e).total);
  }
  const meses = [...porMes].sort((a, b) => b[0].localeCompare(a[0])).map(([k, v]) => {
    const [y, m] = k.split('-');
    return [`${MESES[Number(m) - 1]}/${y}`, { total: v, n: lista.filter((e) => e.entrada.startsWith(k)).length, ativos: lista.filter((e) => e.entrada.startsWith(k) && e.status !== 'devolvido').length }];
  });
  return `
  <header class="head">
    <div><div class="sub">Somatório de valores</div><h1>Relatórios</h1></div>
    <button class="btn sm outline" data-csv>⬇ CSV</button>
  </header>
  <div class="search">
    <select id="rel-obra"><option value="">Todas as obras</option>${obras().map((o) => `<option ${o === state.relObra ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>
    <select id="rel-forn"><option value="">Todos fornecedores</option>${fornecedores().map((o) => `<option ${o === state.relFornecedor ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>
  </div>
  <div class="kpis">
    <div class="kpi wide"><div class="l">Total geral</div><div class="v">${money(geral)}</div></div>
    <div class="kpi"><div class="l">Ativos (${at.length})</div><div class="v sm">${money(tot(at))}</div></div>
    <div class="kpi"><div class="l">Devolvidos (${dv.length})</div><div class="v sm">${money(tot(dv))}</div></div>
    <div class="kpi wide"><div class="l">Outros custos (frete, avarias, taxas) — já incluídos</div><div class="v sm">${money(extras)}</div></div>
  </div>
  ${bloco('Por fornecedor', agrupar('fornecedor', 'Sem fornecedor'))}
  ${bloco('Por obra', agrupar('obra', 'Sem obra'))}
  ${bloco('Por mês de entrada', meses)}
  <p class="muted small">Regra de cálculo (padrão proporcional): períodos cheios × valor + dias avulsos × (valor ÷ dias do período; mensal ÷ 30), × quantidade, + outros custos. Devolvidos: até a data real da devolução. Ativos: projetados até o fim do contrato (ou até hoje, se vencidos). Itens marcados como “período cheio” cobram todo período iniciado e, se devolvidos antes, até o fim do contrato. Regra diferente → “valor total manual”.</p>`;
}

// ---------------------------------------------------------------- formulário
function abrirForm(id) {
  const e = id ? state.equip.find((x) => x.id === id) : null;
  const ent = e?.entrada || hoje();
  const per = e?.periodo || 'mensal';
  const d = e || { nome: '', fornecedor: '', obra: state.obra || ultimaObra(), periodo: per, cobranca: 'proporcional', entrada: ent, fim: addPeriodo(ent, per), qtd: 1, valor: '', extras: '', codigo: '', obs: '', valorManual: '' };
  abrirModal(`
    <h2>${e ? 'Editar equipamento' : 'Novo equipamento'}</h2>
    <p class="muted small" style="margin:0 0 16px">Campos com * são obrigatórios.</p>
    <form id="form-eq" autocomplete="off">
      <div class="field"><label>Equipamento *</label><input name="nome" required value="${esc(d.nome)}" placeholder="Ex.: Martelete 10kg" list="dl-nomes"></div>
      <div class="grid2">
        <div class="field"><label>Fornecedor</label><input name="fornecedor" value="${esc(d.fornecedor)}" placeholder="Locadora" list="dl-forn"></div>
        <div class="field"><label>Obra</label><input name="obra" value="${esc(d.obra)}" placeholder="Obra / centro de custo" list="dl-obras"></div>
      </div>
      <div class="grid2">
        <div class="field"><label>Período</label><div class="select-wrap"><select name="periodo">${Object.entries(PERIODOS).map(([k, p]) => `<option value="${k}" ${k === d.periodo ? 'selected' : ''}>${p.nome}</option>`).join('')}</select></div></div>
        <div class="field"><label>Quantidade</label><input name="qtd" type="number" inputmode="numeric" min="1" step="1" value="${esc(d.qtd || 1)}"></div>
      </div>
      <div class="grid2">
        <div class="field"><label>Entrada *</label><input name="entrada" type="date" required value="${d.entrada}"></div>
        <div class="field"><label>Fim / vencimento *</label><input name="fim" type="date" required value="${d.fim}"></div>
      </div>
      <div class="grid2">
        <div class="field"><label>Valor unit./período</label><input name="valor" inputmode="decimal" placeholder="R$ 0,00" value="${moneyInput(d.valor)}"></div>
        <div class="field"><label>Outros custos</label><input name="extras" inputmode="decimal" placeholder="Frete, avaria" value="${moneyInput(d.extras)}"></div>
      </div>
      <div class="field"><label>Cobrança</label><div class="select-wrap"><select name="cobranca">
        <option value="proporcional" ${d.cobranca !== 'cheio' ? 'selected' : ''}>Proporcional aos dias</option>
        <option value="cheio" ${d.cobranca === 'cheio' ? 'selected' : ''}>Período cheio (iniciado = inteiro)</option></select></div></div>
      <div class="total-box" id="prev-total"></div>
      <div class="field"><label>Valor total manual (opcional)</label><input name="valorManual" inputmode="decimal" placeholder="Substitui o cálculo automático do aluguel" value="${moneyInput(d.valorManual)}"></div>
      <div class="field"><label>Código / contrato</label><input name="codigo" value="${esc(d.codigo)}" placeholder="Ex.: FS0038"></div>
      <div class="field"><label>Observações</label><textarea name="obs" placeholder="Acessórios, estado, nº de série…">${esc(d.obs)}</textarea></div>
      <div class="lbl">📷 Fotos do recebimento</div>
      <div class="photo-grid" id="fotos-rec"></div>
      <div class="sheet-actions">
        <button class="btn primary block" type="submit">${e ? 'Salvar alterações' : 'Cadastrar equipamento'}</button>
        ${e ? `<button class="btn ghost block" type="button" data-excluir="${e.id}">Excluir equipamento</button>` : ''}
        <button class="btn outline block" type="button" data-fechar>Cancelar</button>
      </div>
    </form>
    <datalist id="dl-nomes">${[...new Set(state.equip.map((x) => x.nome))].map((n) => `<option value="${esc(n)}">`).join('')}</datalist>
    <datalist id="dl-forn">${fornecedores().map((n) => `<option value="${esc(n)}">`).join('')}</datalist>
    <datalist id="dl-obras">${obrasSugestao().map((n) => `<option value="${esc(n)}">`).join('')}</datalist>`, {
    onMount: (s) => {
      const f = $('#form-eq', s);
      let fimManual = !!e;
      // cadastro novo: fotos ficam em memória e sobem depois que o registro existir
      const pendentes = e ? null : [];
      const atualizar = () => {
        const tmp = lerForm(f);
        const c = custo({ ...tmp, status: 'ativo' });
        $('#prev-total', s).innerHTML = `<div><small>${c.manual ? 'Valor manual' : `${c.periodos} × ${money(tmp.valor)}/${PERIODOS[tmp.periodo].nome.toLowerCase()} × ${tmp.qtd}`}${tmp.extras ? ` + ${money(tmp.extras)}` : ''}</small>Total previsto</div><b>${money(c.total)}</b>`;
      };
      f.fim.addEventListener('input', () => { fimManual = true; atualizar(); });
      const recalcFim = () => { if (!fimManual && f.entrada.value) f.fim.value = addPeriodo(f.entrada.value, f.periodo.value); atualizar(); };
      f.entrada.addEventListener('input', recalcFim);
      f.periodo.addEventListener('change', () => { if (f.entrada.value) f.fim.value = addPeriodo(f.entrada.value, f.periodo.value); fimManual = false; atualizar(); });
      f.addEventListener('input', atualizar);
      atualizar();

      montarGradeFotos($('#fotos-rec', s), { equipId: e?.id, tipo: 'recebimento', pendentes, getNome: () => f.nome.value || 'Equipamento' });

      const btSalvar = $('button[type=submit]', f);
      f.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const dados = lerForm(f);
        if (!dados.nome) return toast('Informe o nome do equipamento');
        if (!dados.entrada || !dados.fim) return toast('Informe entrada e fim');
        if (dados.fim < dados.entrada) return toast('O fim não pode ser antes da entrada');
        btSalvar.disabled = true;
        const reg = e ? { ...e, ...dados } : { id: uid(), ...dados, status: 'ativo', devolucao: null, retirada: null, renovacoes: [] };
        const ok = await tentar(async () => {
          await salvarEquip(reg, !e);
          if (pendentes?.length) {
            toast('Enviando fotos…');
            for (const p of pendentes) await enviarFoto(reg.id, 'recebimento', p.blob);
          }
        });
        btSalvar.disabled = false;
        if (!ok) return;
        modalFechar = null;
        fecharModal();
        toast(e ? 'Alterações salvas' : 'Equipamento cadastrado');
        render();
      });
      $('[data-fechar]', s).addEventListener('click', () => fecharModal());
      const bx = $('[data-excluir]', s);
      if (bx) bx.addEventListener('click', async () => {
        if (!(await confirmar('Excluir equipamento?', `“${e.nome}” e todas as fotos serão apagados definitivamente para todos os usuários.`, 'Excluir', true))) return abrirForm(e.id);
        const ok = await tentar(async () => {
          const paths = fotosDe(e.id).map((x) => x.path);
          const { error } = await sb.from('locacoes').delete().eq('id', e.id);
          if (error) throw error;
          if (paths.length) await sb.storage.from(BUCKET).remove(paths);
        });
        if (!ok) return;
        state.equip = state.equip.filter((x) => x.id !== e.id);
        state.fotos = state.fotos.filter((x) => x.locacao_id !== e.id);
        salvarSnapshot();
        toast('Equipamento excluído');
        render();
      });
      modalFechar = () => pendentes?.forEach((p) => URL.revokeObjectURL(p.url));
    },
  });
}
function ultimaObra() {
  const ult = [...state.equip].sort((a, b) => (b.criadoEm || '').localeCompare(a.criadoEm || ''))[0];
  return ult?.obra || '';
}
function lerForm(f) {
  const vm = f.valorManual.value.trim();
  return {
    nome: f.nome.value.trim(),
    fornecedor: f.fornecedor.value.trim(),
    obra: f.obra.value.trim(),
    periodo: f.periodo.value,
    cobranca: f.cobranca.value,
    qtd: Math.max(1, parseInt(f.qtd.value, 10) || 1),
    entrada: f.entrada.value,
    fim: f.fim.value,
    valor: parseMoney(f.valor.value),
    extras: parseMoney(f.extras.value),
    valorManual: vm ? parseMoney(vm) : '',
    codigo: f.codigo.value.trim(),
    obs: f.obs.value.trim(),
  };
}

/**
 * Grade de fotos com botão de câmera.
 * - equipId: fotos já salvas no servidor (envio imediato).
 * - pendentes: array em memória para cadastro ainda não salvo.
 */
async function montarGradeFotos(grid, { equipId, tipo, pendentes = null, getNome = () => 'Equipamento', readonly = false }) {
  const desenhar = async () => {
    let itens;
    if (pendentes) itens = pendentes.map((p) => ({ id: p.id, url: p.url, cap: 'Ainda não enviada' }));
    else {
      const fotos = fotosDe(equipId, tipo);
      const urls = await urlsAssinadas(fotos.map((f) => f.path));
      itens = fotos.map((f) => ({ id: f.id, url: urls[f.path], cap: `${new Date(f.criado_em).toLocaleString('pt-BR')}${f.criado_por_email ? ' · ' + f.criado_por_email : ''}` }));
    }
    grid.innerHTML = itens.map((it) => `<div class="ph">${it.url ? `<img src="${esc(it.url)}" data-ver="${it.id}" alt="">` : ''}${readonly ? '' : `<button type="button" class="x" data-rm="${it.id}">×</button>`}</div>`).join('')
      + (readonly ? '' : `<label class="add-photo"><div><span>📷</span>Adicionar</div><input type="file" accept="image/*" multiple></label>`);
    if (readonly && !itens.length) grid.innerHTML = '<p class="muted small">Sem fotos.</p>';
    $$('[data-ver]', grid).forEach((img) => img.addEventListener('click', () => {
      const it = itens.find((x) => x.id === img.dataset.ver);
      verFoto(it.url, `${tipo === 'recebimento' ? 'Recebimento' : 'Entrega'} · ${it.cap}`);
    }));
    $$('[data-rm]', grid).forEach((b) => b.addEventListener('click', async () => {
      if (pendentes) {
        const i = pendentes.findIndex((p) => p.id === b.dataset.rm);
        URL.revokeObjectURL(pendentes[i].url); pendentes.splice(i, 1);
      } else {
        if (!(await confirmarInline(b))) return;
        const f = state.fotos.find((x) => x.id === b.dataset.rm);
        if (!(await tentar(() => removerFoto(f)))) return;
      }
      desenhar();
    }));
    const inp = $('input[type=file]', grid);
    if (inp) inp.addEventListener('change', async () => {
      const files = [...inp.files];
      if (!files.length) return;
      toast('Processando fotos…');
      const blobs = await processarArquivos(getNome(), tipo, files);
      if (pendentes) {
        for (const blob of blobs) pendentes.push({ id: uid(), blob, url: URL.createObjectURL(blob) });
      } else {
        let n = 0;
        const ok = await tentar(async () => { for (const blob of blobs) { await enviarFoto(equipId, tipo, blob); n++; } });
        if (ok) toast(`${n} foto(s) enviada(s)`);
      }
      desenhar();
      agendarRender();
    });
  };
  await desenhar();
}
/** Pede um segundo toque no "×" para apagar foto já enviada (evita exclusão acidental). */
function confirmarInline(btn) {
  if (btn.dataset.armado) return Promise.resolve(true);
  btn.dataset.armado = '1'; btn.textContent = '🗑'; btn.style.background = 'var(--danger)';
  toast('Toque de novo para apagar a foto');
  setTimeout(() => { if (btn.isConnected) { delete btn.dataset.armado; btn.textContent = '×'; btn.style.background = ''; } }, 3000);
  return Promise.resolve(false);
}

function verFoto(url, cap) {
  const d = document.createElement('div');
  d.className = 'viewer';
  d.innerHTML = `<img src="${esc(url)}" alt=""><button class="close" aria-label="Fechar">×</button><div class="cap">${esc(cap)}</div>`;
  d.addEventListener('click', () => d.remove());
  document.body.appendChild(d);
}

// ---------------------------------------------------------------- detalhe
function abrirDetalhe(id) {
  const e = state.equip.find((x) => x.id === id);
  if (!e) return;
  const st = statusDe(e);
  const c = custo(e);
  const hist = [
    { d: e.entrada, t: `Entrada · contrato até ${fmtLonga((e.renovacoes || [])[0]?.de || e.fim)}` },
    ...(e.renovacoes || []).map((r) => ({ d: r.em, t: `Renovado: ${fmtLonga(r.de)} → ${fmtLonga(r.para)}` })),
    ...(e.retirada && e.status !== 'devolvido' ? [{ d: e.retirada, t: 'Retirada agendada' }] : []),
    ...(e.devolucao ? [{ d: e.devolucao, t: 'Devolvido' }] : []),
  ].sort((a, b) => a.d.localeCompare(b.d));
  abrirModal(`
    <h2>${esc(e.nome)}</h2>
    <div class="meta muted">🏢 ${esc(e.fornecedor || '—')} · ${PERIODOS[e.periodo].nome}${e.obra ? ` · 🏗️ ${esc(e.obra)}` : ''}</div>
    <dl class="kv">
      <dt>Status</dt><dd>${{ ok: '🟢 Ativo', alerta: '🟠 Em alerta', vencido: '🔴 Vencido', devolvido: '⚪ Devolvido' }[st.key]}${st.dias != null ? ` (${st.dias < 0 ? Math.abs(st.dias) + 'd vencido' : st.dias + 'd restantes'})` : ''}</dd>
      <dt>Entrada</dt><dd>${fmtLonga(e.entrada)}</dd>
      <dt>Fim do contrato</dt><dd>${fmtLonga(e.fim)}</dd>
      ${e.devolucao ? `<dt>Devolução</dt><dd>${fmtLonga(e.devolucao)}</dd>` : ''}
      <dt>Quantidade</dt><dd>${e.qtd || 1}</dd>
      <dt>Valor unit./período</dt><dd>${money(e.valor)}</dd>
      <dt>Períodos cobrados</dt><dd>${c.manual ? 'manual' : c.periodos}</dd>
      <dt>Aluguel</dt><dd>${money(c.aluguel)}</dd>
      ${c.extras ? `<dt>Outros custos</dt><dd>${money(c.extras)}</dd>` : ''}
      <dt><b>Total</b></dt><dd><b>${money(c.total)}</b></dd>
      <dt>Cobrança</dt><dd>${e.cobranca === 'cheio' ? 'Período cheio' : 'Proporcional'}</dd>
      ${e.codigo ? `<dt>Código</dt><dd>${esc(e.codigo)}</dd>` : ''}
    </dl>
    <p class="muted small">Cadastrado por ${esc(e.criadoPorEmail || '—')} em ${e.criadoEm ? new Date(e.criadoEm).toLocaleString('pt-BR') : '—'}${e.atualizadoPorEmail && e.atualizadoEm !== e.criadoEm ? ` · última alteração por ${esc(e.atualizadoPorEmail)} em ${new Date(e.atualizadoEm).toLocaleString('pt-BR')}` : ''}</p>
    ${e.obs ? `<div class="note">${esc(e.obs)}</div>` : ''}
    <div class="sec-title">📷 Recebimento</div><div class="photo-grid" id="d-rec"></div>
    <div class="sec-title">📷 Entrega / devolução</div><div class="photo-grid" id="d-ent"></div>
    <div class="sec-title">Histórico</div>
    <ul class="timeline">${hist.map((h) => `<li><b>${fmtLonga(h.d)}</b> — ${esc(h.t)}</li>`).join('')}</ul>
    <div class="sheet-actions">
      ${e.status !== 'devolvido' ? `<div class="card-actions"><button class="btn primary" data-renovar="${e.id}">🔄 Renovar</button><button class="btn" data-devolver="${e.id}">📦 Devolver</button></div>
        <button class="btn outline block" data-ics="${e.id}">📅 Lembrete no Calendário</button>` : ''}
      ${(e.renovacoes || []).length && e.status !== 'devolvido' ? `<button class="btn ghost block" data-desfazer-ren="${e.id}">↩ Desfazer última renovação</button>` : ''}
      ${e.status === 'devolvido' ? `<button class="btn outline block" data-reabrir="${e.id}">↩ Reabrir (desfazer devolução)</button>` : ''}
      <button class="btn outline block" data-edit="${e.id}">✏️ Editar</button>
    </div>`, {
    onMount: (s) => {
      montarGradeFotos($('#d-rec', s), { equipId: e.id, tipo: 'recebimento', getNome: () => e.nome });
      montarGradeFotos($('#d-ent', s), { equipId: e.id, tipo: 'entrega', getNome: () => e.nome });
    },
  });
}

// ---------------------------------------------------------------- renovar / devolver
function abrirRenovar(id) {
  const e = state.equip.find((x) => x.id === id);
  const sug = addPeriodo(e.fim, e.periodo);
  abrirModal(`
    <div class="center-head"><div class="emoji">🔄</div><h2>Renovar locação</h2><div class="sub">${esc(e.nome)}</div>
      <p>Fim atual: ${fmtLonga(e.fim)}. Ajuste a nova data de vencimento se necessário.</p></div>
    <div class="field"><label>Nova data de fim</label><input type="date" id="ren-data" value="${sug}" min="${e.fim}"></div>
    <div class="total-box" id="ren-prev"></div>
    <div class="sheet-actions two">
      <button class="btn outline" data-fechar>Cancelar</button>
      <button class="btn primary" id="ren-ok">🔄 Confirmar renovação</button>
    </div>`, {
    center: true,
    onMount: (s) => {
      const inp = $('#ren-data', s);
      const prev = () => {
        const c0 = custo(e).total;
        const c1 = inp.value ? custo({ ...e, fim: inp.value }).total : c0;
        $('#ren-prev', s).innerHTML = `<div><small>Acréscimo no custo</small>Novo total ${money(c1)}</div><b>+${money(c1 - c0)}</b>`;
      };
      inp.addEventListener('input', prev); prev();
      $('[data-fechar]', s).addEventListener('click', fecharModal);
      $('#ren-ok', s).addEventListener('click', async () => {
        const nova = inp.value;
        if (!nova || nova <= e.fim) return toast('A nova data deve ser depois do fim atual');
        const reg = { ...e, fim: nova, renovacoes: [...(e.renovacoes || []), { em: hoje(), de: e.fim, para: nova }] };
        if (!(await tentar(() => salvarEquip(reg)))) return;
        fecharModal();
        toast(`Renovado até ${fmtLonga(nova)}`);
        render();
      });
    },
  });
}

function abrirDevolver(id) {
  const e = state.equip.find((x) => x.id === id);
  abrirModal(`
    <div class="center-head"><div class="emoji">📦</div><h2>Devolução do equipamento</h2><div class="sub">${esc(e.nome)}</div>
      <p>Agende a retirada para depois ou confirme a devolução agora.</p></div>
    <div class="field"><label>Data</label><input type="date" id="dev-data" value="${e.retirada && e.retirada > hoje() ? e.retirada : hoje()}">
      <div class="hint">Hoje (ou antes) para confirmar a devolução; data futura para agendar a retirada.</div></div>
    <div class="lbl">📷 Fotos da entrega (estado na devolução)</div>
    <div class="photo-grid" id="dev-fotos"></div>
    <div class="total-box" id="dev-prev"></div>
    <div class="sheet-actions">
      <button class="btn warn block" id="dev-agendar">📅 Agendar retirada</button>
      <button class="btn danger block" id="dev-ok">📦 Confirmar devolução</button>
      <button class="btn ghost block" data-fechar>Cancelar</button>
    </div>`, {
    center: true,
    onMount: (s) => {
      const inp = $('#dev-data', s);
      const bA = $('#dev-agendar', s), bC = $('#dev-ok', s);
      const upd = () => {
        const v = inp.value;
        bA.disabled = !v || v <= hoje();
        bC.disabled = !v || v > hoje() || v < e.entrada;
        if (v) {
          const c = custo({ ...e, status: 'devolvido', devolucao: v });
          $('#dev-prev', s).innerHTML = `<div><small>${c.manual ? 'Valor manual' : c.periodos + ' cobrado(s)'}</small>${v > hoje() ? 'Custo previsto' : 'Custo final'}</div><b>${money(c.total)}</b>`;
        }
      };
      inp.addEventListener('input', upd); upd();
      montarGradeFotos($('#dev-fotos', s), { equipId: e.id, tipo: 'entrega', getNome: () => e.nome });
      $('[data-fechar]', s).addEventListener('click', fecharModal);
      bA.addEventListener('click', async () => {
        if (!(await tentar(() => salvarEquip({ ...e, retirada: inp.value })))) return;
        fecharModal();
        toast(`Retirada agendada para ${fmtLonga(inp.value)}`);
        render();
      });
      bC.addEventListener('click', async () => {
        if (!(await tentar(() => salvarEquip({ ...e, status: 'devolvido', devolucao: inp.value, retirada: null })))) return;
        fecharModal();
        toast('Devolução registrada');
        render();
      });
    },
  });
}

// ---------------------------------------------------------------- calendário (.ics)
function icsEsc(s) { return String(s || '').replace(/[\\;,]/g, (c) => '\\' + c).replace(/\n/g, '\\n'); }
function gerarICS(lista) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const ev = [];
  for (const e of lista) {
    const dt = e.fim.replace(/-/g, '');
    const fimEv = addPeriodo(e.fim, 'diaria').replace(/-/g, '');
    ev.push([
      'BEGIN:VEVENT',
      `UID:${e.id}-fim-${dt}@cmr-locacoes`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${dt}`,
      `DTEND;VALUE=DATE:${fimEv}`,
      `SUMMARY:${icsEsc(`Vence locação: ${e.nome}${e.fornecedor ? ' (' + e.fornecedor + ')' : ''}`)}`,
      `DESCRIPTION:${icsEsc(`Obra: ${e.obra || '—'}\nEntrada: ${fmtLonga(e.entrada)}\nCódigo: ${e.codigo || '—'}\nRenovar ou devolver.`)}`,
      'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsEsc('Locação vence em ' + state.cfg.alertaDias + ' dias: ' + e.nome)}`, `TRIGGER:-P${state.cfg.alertaDias}D`, 'END:VALARM',
      'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsEsc('Locação vence hoje: ' + e.nome)}`, 'TRIGGER:PT8H', 'END:VALARM',
      'END:VEVENT',
    ].join('\r\n'));
  }
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//CMR Empreendimentos//Locacoes//PT', 'CALSCALE:GREGORIAN', ...ev, 'END:VCALENDAR'].join('\r\n');
}

// ---------------------------------------------------------------- CSV
function exportarCSV() {
  const cols = ['Equipamento', 'Qtd', 'Fornecedor', 'Obra', 'Período', 'Entrada', 'Fim', 'Devolução', 'Status', 'Renovações', 'Cobrança', 'Valor unit.', 'Períodos', 'Aluguel', 'Outros custos', 'Total', 'Código', 'Observações', 'Cadastrado por'];
  let lista = state.equip;
  if (state.relObra) lista = lista.filter((e) => e.obra === state.relObra);
  if (state.relFornecedor) lista = lista.filter((e) => e.fornecedor === state.relFornecedor);
  const num = (v) => (Number(v) || 0).toFixed(2).replace('.', ',');
  const cel = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const linhas = [...lista].sort((a, b) => a.entrada.localeCompare(b.entrada)).map((e) => {
    const c = custo(e);
    return [e.nome, e.qtd || 1, e.fornecedor, e.obra, PERIODOS[e.periodo].nome, fmtLonga(e.entrada), fmtLonga(e.fim), e.devolucao ? fmtLonga(e.devolucao) : '',
      statusDe(e).key, (e.renovacoes || []).length, e.cobranca === 'cheio' ? 'período cheio' : 'proporcional', num(e.valor), c.manual ? 'manual' : c.periodos, num(c.aluguel), num(c.extras), num(c.total), e.codigo, e.obs, e.criadoPorEmail].map(cel).join(';');
  });
  // BOM + ';' para o Excel pt-BR abrir direto
  entregarArquivo(`locacoes-${hoje()}.csv`, '﻿' + [cols.map(cel).join(';'), ...linhas].join('\r\n'), 'text/csv');
}

// ---------------------------------------------------------------- ajustes
function abrirAjustes() {
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  abrirModal(`
    <h2>Ajustes</h2>
    <p class="muted small" style="margin:0">Conectado como <b>${esc(state.usuario)}</b></p>
    ${!standalone ? `<div class="banner warn small mt">📲 Para usar como app: no Safari toque em Compartilhar → “Adicionar à Tela de Início”.</div>` : ''}
    <div class="field mt"><label>Alertar com quantos dias de antecedência</label><input type="number" id="cfg-dias" inputmode="numeric" min="0" max="60" value="${state.cfg.alertaDias}">
      <div class="hint">Vale só para este aparelho.</div></div>
    <div class="switch"><div><b>Notificações</b><div class="muted small">Aviso diário ao abrir o app, e contador no ícone.</div></div>
      <button class="btn sm ${state.cfg.notificar ? 'primary' : 'outline'}" data-ativar-notif>${state.cfg.notificar ? 'Ativadas' : 'Ativar'}</button></div>
    <div class="switch"><div><b>Calendário do celular</b><div class="muted small">Lembretes que disparam mesmo com o app fechado.</div></div>
      <button class="btn sm outline" data-ics-todos>Exportar</button></div>
    <div class="sec-title">Dados</div>
    <p class="muted small">Os dados ficam na nuvem da CMR e são compartilhados em tempo real com todos os usuários autorizados. Este aparelho guarda uma cópia para consulta sem internet.</p>
    <div class="sheet-actions">
      <button class="btn outline block" data-csv>⬇ Exportar planilha (CSV)</button>
      <button class="btn outline block" data-recarregar>🔄 Recarregar dados</button>
      <button class="btn ghost block" data-sair>Sair da conta</button>
      <button class="btn primary block" data-fechar>Fechar</button>
    </div>
    <p class="muted small mt" style="text-align:center">CMR Locações · v2.0</p>`, {
    onMount: (s) => {
      $('#cfg-dias', s).addEventListener('change', (ev) => {
        state.cfg.alertaDias = Math.min(60, Math.max(0, parseInt(ev.target.value, 10) || 0));
        salvarCfg(); render();
      });
      $('[data-fechar]', s).addEventListener('click', fecharModal);
    },
  });
}

async function ativarNotificacoes() {
  if (!('Notification' in window)) {
    return toast('Este navegador não suporta notificações. No iPhone, instale o app na Tela de Início (iOS 16.4+).');
  }
  const p = await Notification.requestPermission();
  state.cfg.notificar = p === 'granted';
  state.cfg.ultimaNotif = null;
  salvarCfg();
  if (state.cfg.notificar) { toast('Notificações ativadas'); await notificarAlertas(); } else toast('Permissão negada nas configurações do aparelho');
  if ($('#modal-root').innerHTML) abrirAjustes();
  render();
}

/** Dispara no máx. 1 notificação por dia, ao abrir o app. */
async function notificarAlertas() {
  if (!state.cfg.notificar || !('Notification' in window) || Notification.permission !== 'granted') return;
  if (state.cfg.ultimaNotif === hoje()) return;
  const lista = ativos().filter(emAlerta).sort(ordenarPorFim);
  if (!lista.length) return;
  const venc = lista.filter((e) => statusDe(e).key === 'vencido').length;
  const corpo = lista.slice(0, 4).map((e) => { const d = statusDe(e).dias; return `${e.nome}: ${d < 0 ? Math.abs(d) + 'd vencido' : d === 0 ? 'vence hoje' : 'vence em ' + d + 'd'}`; }).join('\n');
  const titulo = venc ? `${venc} locação(ões) vencida(s)` : `${lista.length} locação(ões) vencendo`;
  try {
    const reg = await navigator.serviceWorker?.ready;
    if (reg?.showNotification) await reg.showNotification(titulo, { body: corpo, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: 'alertas' });
    else new Notification(titulo, { body: corpo });
    state.cfg.ultimaNotif = hoje();
    salvarCfg();
  } catch (err) { console.warn(err); }
}

// ---------------------------------------------------------------- eventos
document.addEventListener('click', async (ev) => {
  const t = ev.target.closest('button, [data-open], label');
  if (!t) return;
  const ds = t.dataset;
  if (ds.nav) { state.view = ds.nav; fecharModal(); render(); window.scrollTo(0, 0); return; }
  if (ds.navTo) { state.view = ds.navTo; render(); window.scrollTo(0, 0); return; }
  if (ds.goto) { state.view = 'equipamentos'; state.filtro = ds.goto; render(); window.scrollTo(0, 0); return; }
  if (ds.filtro) { state.filtro = ds.filtro; render(); return; }
  if ('novo' in ds) return abrirForm();
  if (ds.edit) { ev.stopPropagation(); return abrirForm(ds.edit); }
  if (ds.renovar) { ev.stopPropagation(); return abrirRenovar(ds.renovar); }
  if (ds.devolver) { ev.stopPropagation(); return abrirDevolver(ds.devolver); }
  if ('ajustes' in ds) return abrirAjustes();
  if ('ativarNotif' in ds) return ativarNotificacoes();
  if ('csv' in ds) return exportarCSV();
  if ('sair' in ds) { fecharModal(); await sb.auth.signOut(); return; }
  if ('recarregar' in ds) { fecharModal(); await sincronizar(true); return; }
  if ('esqueci' in ds) return esqueciSenha();
  if ('icsTodos' in ds) {
    const l = ativos();
    if (!l.length) return toast('Nenhuma locação ativa');
    return entregarArquivo(`vencimentos-${hoje()}.ics`, gerarICS(l), 'text/calendar');
  }
  if (ds.ics) { const e = state.equip.find((x) => x.id === ds.ics); return entregarArquivo(`${e.nome.replace(/\W+/g, '-')}.ics`, gerarICS([e]), 'text/calendar'); }
  if (ds.desfazerRen) {
    const e = state.equip.find((x) => x.id === ds.desfazerRen);
    const r = e.renovacoes[e.renovacoes.length - 1];
    if (!(await confirmar('Desfazer renovação?', `O fim volta de ${fmtLonga(r.para)} para ${fmtLonga(r.de)}.`, 'Desfazer'))) return abrirDetalhe(e.id);
    if (!(await tentar(() => salvarEquip({ ...e, renovacoes: e.renovacoes.slice(0, -1), fim: r.de })))) return;
    toast('Renovação desfeita'); render(); return;
  }
  if (ds.reabrir) {
    const e = state.equip.find((x) => x.id === ds.reabrir);
    if (!(await confirmar('Reabrir locação?', 'O equipamento volta para a lista de ativos.', 'Reabrir'))) return abrirDetalhe(e.id);
    if (!(await tentar(() => salvarEquip({ ...e, status: 'ativo', devolucao: null })))) return;
    toast('Locação reaberta'); render(); return;
  }
  if (ds.open) return abrirDetalhe(ds.open);
});

document.addEventListener('input', (ev) => {
  if (ev.target.id === 'busca') {
    state.busca = ev.target.value;
    const pos = ev.target.selectionStart;
    render();
    const b = $('#busca'); b.focus(); b.setSelectionRange(pos, pos);
  }
});
document.addEventListener('change', (ev) => {
  if (ev.target.id === 'obra-filtro') { state.obra = ev.target.value; render(); }
  if (ev.target.id === 'rel-obra') { state.relObra = ev.target.value; render(); }
  if (ev.target.id === 'rel-forn') { state.relFornecedor = ev.target.value; render(); }
});
document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') fecharModal(); });
// Ao voltar para o app (ou virar o dia), recalcula status/alertas
document.addEventListener('visibilitychange', () => { if (!document.hidden && state.acesso) sincronizar(); });
window.addEventListener('online', () => { if (state.acesso) sincronizar(); });
document.addEventListener('submit', async (ev) => {
  if (ev.target.id !== 'form-login') return;
  ev.preventDefault();
  const f = ev.target, bt = $('button[type=submit]', f);
  bt.disabled = true; bt.textContent = 'Entrando…';
  const { error } = await sb.auth.signInWithPassword({ email: f.email.value.trim(), password: f.senha.value });
  bt.disabled = false; bt.textContent = 'Entrar';
  if (error) toast(/invalid/i.test(error.message) ? 'E-mail ou senha incorretos' : erroRede(error));
});

// ---------------------------------------------------------------- auth / sync
async function esqueciSenha() {
  const email = ($('#form-login')?.email.value || '').trim();
  if (!email) return toast('Digite seu e-mail no campo acima');
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
  toast(error ? erroRede(error) : 'Enviamos um link de redefinição para o seu e-mail');
}
function pedirNovaSenha() {
  abrirModal(`
    <div class="center-head"><div class="emoji">🔑</div><h2>Definir nova senha</h2></div>
    <form id="form-senha"><div class="field"><label>Nova senha</label><input name="senha" type="password" minlength="8" autocomplete="new-password" required></div>
    <button class="btn primary block" type="submit">Salvar senha</button></form>`, {
    center: true,
    onMount: (s) => $('#form-senha', s).addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const { error } = await sb.auth.updateUser({ password: ev.target.senha.value });
      if (error) return toast(erroRede(error));
      fecharModal(); toast('Senha alterada');
    }),
  });
}

let canal = null;
let sincronizando = null;
/** Busca tudo do servidor; se falhar, usa o snapshot local (modo leitura). */
function sincronizar(avisar = false) {
  if (sincronizando) return sincronizando;
  sincronizando = (async () => {
    try {
      await carregarDados();
      if (avisar) toast('Dados atualizados');
    } catch (err) {
      console.warn('sync', err);
      const snap = lerLS(LS_SNAP, null);
      if (snap && snap.usuario === state.usuario) {
        state.equip = snap.equip; state.fotos = snap.fotos; state.projetos = snap.projetos || [];
      }
      state.offline = true;
      if (avisar) toast(erroRede(err));
    } finally {
      sincronizando = null;
    }
    render();
    notificarAlertas();
  })();
  return sincronizando;
}

function assinarRealtime() {
  if (canal) return;
  canal = sb.channel('locacoes-sync')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'locacoes' }, (p) => {
      if (p.eventType === 'DELETE') state.equip = state.equip.filter((x) => x.id !== p.old.id);
      else mesclarEquip(fromRow(p.new));
      salvarSnapshot(); agendarRender();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'locacao_fotos' }, (p) => {
      if (p.eventType === 'DELETE') state.fotos = state.fotos.filter((x) => x.id !== p.old.id);
      else if (!state.fotos.some((x) => x.id === p.new.id)) state.fotos.push(p.new);
      salvarSnapshot(); agendarRender();
    })
    .subscribe();
}

async function aoMudarSessao(session) {
  const email = session?.user?.email || null;
  if (email === state.usuario && state.acesso !== null) return;
  state.usuario = email;
  if (!email) {
    state.acesso = null; state.equip = []; state.fotos = [];
    if (canal) { sb.removeChannel(canal); canal = null; }
    fecharModal(); render(); return;
  }
  // Snapshot do mesmo usuário: mostra na hora, sincroniza em seguida.
  const snap = lerLS(LS_SNAP, null);
  if (snap && snap.usuario === email) {
    state.equip = snap.equip; state.fotos = snap.fotos; state.projetos = snap.projetos || []; state.acesso = true; render();
  } else { state.acesso = null; render(); }
  const { data, error } = await sb.rpc('is_platform_user');
  if (error) console.warn('is_platform_user', error); // sem rede ou sem permissão de execução: o RLS decide
  state.acesso = error ? (state.acesso ?? true) : !!data;
  if (!state.acesso) { render(); return; }
  await sincronizar();
  assinarRealtime();
}

// ---------------------------------------------------------------- init
(function init() {
  const inicial = new URLSearchParams(location.search).get('v');
  if (inicial && ['inicio', 'agenda', 'relatorios', 'equipamentos'].includes(inicial)) state.view = inicial;
  sb.auth.onAuthStateChange((evento, session) => {
    if (evento === 'PASSWORD_RECOVERY') setTimeout(pedirNovaSenha, 300);
    // callback do supabase-js não pode aguardar outras chamadas ao cliente: agenda fora dele
    setTimeout(() => aoMudarSessao(session), 0);
  });
  render();
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW', e));
  }
})();
