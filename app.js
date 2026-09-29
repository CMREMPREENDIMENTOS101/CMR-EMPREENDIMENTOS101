'use strict';

/* =====================================================================
 * CMR Locações — controle de equipamentos locados em obra
 * PWA offline-first. Dados em IndexedDB (equipamentos + fotos).
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

/**
 * Data de referência para cobrança:
 *  - devolvido: max(devolução, fim contratado) — devolução antecipada paga o período contratado;
 *    devolução atrasada paga até a data real.
 *  - ativo: max(hoje, fim contratado) — previsão do compromisso atual.
 */
function refCobranca(e) {
  return e.status === 'devolvido' ? maxISO(e.devolucao, e.fim) : maxISO(hoje(), e.fim);
}
function custo(e) {
  const periodos = contarPeriodos(e.entrada, refCobranca(e), e.periodo);
  const aluguel = e.valorManual != null && e.valorManual !== ''
    ? Number(e.valorManual)
    : periodos * (Number(e.valor) || 0) * (Number(e.qtd) || 1);
  const extras = Number(e.extras) || 0;
  return { periodos, aluguel, extras, total: aluguel + extras, manual: e.valorManual != null && e.valorManual !== '' };
}

// ---------------------------------------------------------------- IndexedDB
const DB_NAME = 'cmr-locacoes';
let db;
function abrirDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore('equip', { keyPath: 'id' });
      const f = d.createObjectStore('fotos', { keyPath: 'id' });
      f.createIndex('equipId', 'equipId');
      d.createObjectStore('kv');
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
function tx(store, mode, fn) {
  return new Promise((res, rej) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let out;
    const req = fn(s);
    if (req) req.onsuccess = () => { out = req.result; };
    t.oncomplete = () => res(out);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  });
}
const dbAll = (store) => tx(store, 'readonly', (s) => s.getAll());
const dbGet = (store, key) => tx(store, 'readonly', (s) => s.get(key));
const dbPut = (store, val, key) => tx(store, 'readwrite', (s) => (key !== undefined ? s.put(val, key) : s.put(val)));
const dbDel = (store, key) => tx(store, 'readwrite', (s) => s.delete(key));
const fotosDoEquip = (equipId) => tx('fotos', 'readonly', (s) => s.index('equipId').getAll(equipId));

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

// ---------------------------------------------------------------- estado
const CFG_PADRAO = { alertaDias: 7, notificar: false, ultimaNotif: null };
const state = {
  equip: [],
  cfg: { ...CFG_PADRAO },
  view: 'inicio',
  filtro: 'ativos',
  busca: '',
  obra: '',
  relObra: '',
  relFornecedor: '',
};

async function salvarEquip(e) {
  e.atualizadoEm = new Date().toISOString();
  await dbPut('equip', e);
  const i = state.equip.findIndex((x) => x.id === e.id);
  if (i >= 0) state.equip[i] = e; else state.equip.push(e);
}
async function salvarCfg() { await dbPut('kv', state.cfg, 'cfg'); }

// ---------------------------------------------------------------- fotos
const urlCache = new Map();
function fotoURL(f) {
  if (!urlCache.has(f.id)) urlCache.set(f.id, URL.createObjectURL(f.blob));
  return urlCache.get(f.id);
}
function soltarURL(id) { const u = urlCache.get(id); if (u) { URL.revokeObjectURL(u); urlCache.delete(id); } }

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
async function adicionarFotos(equip, tipo, files) {
  const legenda = `${tipo === 'recebimento' ? 'RECEBIMENTO' : 'ENTREGA'} · ${equip.nome}`;
  let n = 0;
  for (const f of files) {
    try {
      const blob = await processarFoto(f, legenda);
      await dbPut('fotos', { id: uid(), equipId: equip.id, tipo, blob, criadoEm: new Date().toISOString() });
      n++;
    } catch (err) {
      console.error(err);
      toast('Não foi possível processar uma das fotos');
    }
  }
  return n;
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
  $$('#tabbar [data-nav]').forEach((b) => b.classList.toggle('on', b.dataset.nav === state.view));
  const nAlert = state.equip.filter((e) => e.status !== 'devolvido' && emAlerta(e)).length;
  const eqBtn = $('#tabbar [data-nav="equipamentos"]');
  $('.dot', eqBtn)?.remove();
  if (nAlert) eqBtn.insertAdjacentHTML('beforeend', `<i class="dot">${nAlert}</i>`);
  if (navigator.setAppBadge) (nAlert ? navigator.setAppBadge(nAlert) : navigator.clearAppBadge()).catch(() => {});

  const v = $('#view');
  v.innerHTML = ({ inicio: viewInicio, agenda: viewAgenda, relatorios: viewRelatorios, equipamentos: viewEquipamentos }[state.view])();
  carregarThumbs(v);
}

async function carregarThumbs(root) {
  for (const el of $$('[data-thumbs]', root)) {
    const fotos = (await fotosDoEquip(el.dataset.thumbs)).slice(-4);
    el.innerHTML = fotos.map((f) => `<img src="${fotoURL(f)}" alt="">`).join('');
    el.hidden = !fotos.length;
  }
}

const ativos = () => state.equip.filter((e) => e.status !== 'devolvido');
const ordenarPorFim = (a, b) => (a.fim < b.fim ? -1 : a.fim > b.fim ? 1 : a.nome.localeCompare(b.nome));
const obras = () => [...new Set(state.equip.map((e) => e.obra).filter(Boolean))].sort((a, b) => a.localeCompare(b));
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
  <p class="muted small">Regra de cálculo: períodos cobrados × valor unitário × quantidade + outros custos. Período iniciado conta como período cheio. Devolução antes do fim cobra até o fim do contrato; devolução depois do fim cobra até a data real. Ativos são projetados até o fim do contrato (ou até hoje, se vencidos). Se o contrato tiver outra regra, informe o “valor total manual” no cadastro.</p>`;
}

// ---------------------------------------------------------------- formulário
function abrirForm(id) {
  const e = id ? state.equip.find((x) => x.id === id) : null;
  const ent = e?.entrada || hoje();
  const per = e?.periodo || 'mensal';
  const d = e || { nome: '', fornecedor: '', obra: state.obra || ultimaObra(), periodo: per, entrada: ent, fim: addPeriodo(ent, per), qtd: 1, valor: '', extras: '', codigo: '', obs: '', valorManual: '' };
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
    <datalist id="dl-obras">${obras().map((n) => `<option value="${esc(n)}">`).join('')}</datalist>`, {
    onMount: (s) => {
      const f = $('#form-eq', s);
      let fimManual = !!e;
      // fotos pendentes (novo cadastro ainda não tem id salvo)
      const tmpId = e?.id || uid();
      const pendentes = [];
      const atualizar = () => {
        const tmp = lerForm(f);
        const c = custo({ ...tmp, status: 'ativo' });
        $('#prev-total', s).innerHTML = `<div><small>${c.manual ? 'Valor manual' : `${c.periodos} período(s) × ${money(tmp.valor)} × ${tmp.qtd}`}${tmp.extras ? ` + ${money(tmp.extras)}` : ''}</small>Total previsto</div><b>${money(c.total)}</b>`;
      };
      f.fim.addEventListener('input', () => { fimManual = true; atualizar(); });
      const recalcFim = () => { if (!fimManual && f.entrada.value) f.fim.value = addPeriodo(f.entrada.value, f.periodo.value); atualizar(); };
      f.entrada.addEventListener('input', recalcFim);
      f.periodo.addEventListener('change', () => { if (f.entrada.value) f.fim.value = addPeriodo(f.entrada.value, f.periodo.value); fimManual = false; atualizar(); });
      f.addEventListener('input', atualizar);
      atualizar();

      const gridRec = $('#fotos-rec', s);
      montarGradeFotos(gridRec, { id: tmpId, nome: f.nome.value || 'Equipamento' }, 'recebimento', {
        getNome: () => f.nome.value || 'Equipamento',
        onNovo: (ids) => pendentes.push(...ids),
      });

      f.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const dados = lerForm(f);
        if (!dados.nome) return toast('Informe o nome do equipamento');
        if (dados.fim < dados.entrada) return toast('O fim não pode ser antes da entrada');
        const novo = e ? { ...e, ...dados } : {
          id: tmpId, ...dados, status: 'ativo', devolucao: null, retirada: null, renovacoes: [], criadoEm: new Date().toISOString(),
        };
        await salvarEquip(novo);
        pendentes.length = 0;
        modalFechar = null;
        fecharModal();
        toast(e ? 'Alterações salvas' : 'Equipamento cadastrado');
        render();
      });
      $('[data-fechar]', s).addEventListener('click', () => fecharModal());
      const bx = $('[data-excluir]', s);
      if (bx) bx.addEventListener('click', async () => {
        if (!(await confirmar('Excluir equipamento?', `“${e.nome}” e todas as fotos serão apagados definitivamente.`, 'Excluir', true))) return abrirForm(e.id);
        for (const ft of await fotosDoEquip(e.id)) { await dbDel('fotos', ft.id); soltarURL(ft.id); }
        await dbDel('equip', e.id);
        state.equip = state.equip.filter((x) => x.id !== e.id);
        toast('Equipamento excluído');
        render();
      });
      // cancelar cadastro novo: descarta fotos órfãs
      modalFechar = async () => {
        if (!e) for (const pid of pendentes) { await dbDel('fotos', pid); soltarURL(pid); }
      };
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

/** Grade de fotos com botão de câmera. equipRef precisa de id. */
async function montarGradeFotos(grid, equipRef, tipo, { getNome, onNovo, readonly } = {}) {
  const desenhar = async () => {
    const fotos = (await fotosDoEquip(equipRef.id)).filter((f) => f.tipo === tipo);
    grid.innerHTML = fotos.map((f) => `<div class="ph"><img src="${fotoURL(f)}" data-ver="${f.id}" alt="">${readonly ? '' : `<button type="button" class="x" data-rm="${f.id}">×</button>`}</div>`).join('')
      + (readonly ? '' : `<label class="add-photo"><div><span>📷</span>Adicionar</div><input type="file" accept="image/*" multiple></label>`);
    if (readonly && !fotos.length) grid.innerHTML = '<p class="muted small">Sem fotos.</p>';
    $$('[data-ver]', grid).forEach((img) => img.addEventListener('click', () => verFoto(fotos.find((f) => f.id === img.dataset.ver))));
    $$('[data-rm]', grid).forEach((b) => b.addEventListener('click', async () => {
      await dbDel('fotos', b.dataset.rm); soltarURL(b.dataset.rm); desenhar();
    }));
    const inp = $('input[type=file]', grid);
    if (inp) inp.addEventListener('change', async () => {
      const files = [...inp.files];
      if (!files.length) return;
      toast('Processando fotos…');
      const antes = new Set((await fotosDoEquip(equipRef.id)).map((f) => f.id));
      const n = await adicionarFotos({ id: equipRef.id, nome: getNome ? getNome() : equipRef.nome }, tipo, files);
      const novos = (await fotosDoEquip(equipRef.id)).filter((f) => !antes.has(f.id)).map((f) => f.id);
      if (onNovo) onNovo(novos);
      toast(`${n} foto(s) adicionada(s)`);
      desenhar();
    });
  };
  await desenhar();
}

function verFoto(f) {
  const d = document.createElement('div');
  d.className = 'viewer';
  d.innerHTML = `<img src="${fotoURL(f)}" alt=""><button class="close" aria-label="Fechar">×</button><div class="cap">${f.tipo === 'recebimento' ? 'Recebimento' : 'Entrega'} · ${new Date(f.criadoEm).toLocaleString('pt-BR')}</div>`;
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
      ${e.codigo ? `<dt>Código</dt><dd>${esc(e.codigo)}</dd>` : ''}
    </dl>
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
      montarGradeFotos($('#d-rec', s), e, 'recebimento');
      montarGradeFotos($('#d-ent', s), e, 'entrega');
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
        e.renovacoes = [...(e.renovacoes || []), { em: hoje(), de: e.fim, para: nova }];
        e.fim = nova;
        await salvarEquip(e);
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
          $('#dev-prev', s).innerHTML = `<div><small>${c.periodos} período(s) cobrado(s)</small>Custo final</div><b>${money(c.total)}</b>`;
        }
      };
      inp.addEventListener('input', upd); upd();
      montarGradeFotos($('#dev-fotos', s), e, 'entrega');
      $('[data-fechar]', s).addEventListener('click', fecharModal);
      bA.addEventListener('click', async () => {
        e.retirada = inp.value;
        await salvarEquip(e);
        fecharModal();
        toast(`Retirada agendada para ${fmtLonga(e.retirada)}`);
        render();
      });
      bC.addEventListener('click', async () => {
        e.status = 'devolvido';
        e.devolucao = inp.value;
        e.retirada = null;
        await salvarEquip(e);
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

// ---------------------------------------------------------------- CSV / backup
function exportarCSV() {
  const cols = ['Equipamento', 'Qtd', 'Fornecedor', 'Obra', 'Período', 'Entrada', 'Fim', 'Devolução', 'Status', 'Renovações', 'Valor unit.', 'Períodos', 'Aluguel', 'Outros custos', 'Total', 'Código', 'Observações'];
  let lista = state.equip;
  if (state.relObra) lista = lista.filter((e) => e.obra === state.relObra);
  if (state.relFornecedor) lista = lista.filter((e) => e.fornecedor === state.relFornecedor);
  const num = (v) => (Number(v) || 0).toFixed(2).replace('.', ',');
  const cel = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const linhas = [...lista].sort((a, b) => a.entrada.localeCompare(b.entrada)).map((e) => {
    const c = custo(e);
    return [e.nome, e.qtd || 1, e.fornecedor, e.obra, PERIODOS[e.periodo].nome, fmtLonga(e.entrada), fmtLonga(e.fim), e.devolucao ? fmtLonga(e.devolucao) : '',
      statusDe(e).key, (e.renovacoes || []).length, num(e.valor), c.manual ? 'manual' : c.periodos, num(c.aluguel), num(c.extras), num(c.total), e.codigo, e.obs].map(cel).join(';');
  });
  // BOM + ';' para o Excel pt-BR abrir direto
  entregarArquivo(`locacoes-${hoje()}.csv`, '﻿' + [cols.map(cel).join(';'), ...linhas].join('\r\n'), 'text/csv');
}

const blobToB64 = (b) => new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(b); });
async function exportarBackup() {
  toast('Gerando backup…');
  const fotos = await dbAll('fotos');
  const out = {
    app: 'cmr-locacoes', versao: 1, geradoEm: new Date().toISOString(), cfg: state.cfg, equip: state.equip,
    fotos: await Promise.all(fotos.map(async (f) => ({ ...f, blob: await blobToB64(f.blob) }))),
  };
  await entregarArquivo(`backup-locacoes-${hoje()}.json`, JSON.stringify(out), 'application/json');
}
async function importarBackup(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch (_) { return toast('Arquivo inválido'); }
  if (data.app !== 'cmr-locacoes' || !Array.isArray(data.equip)) return toast('Este arquivo não é um backup do app');
  if (!(await confirmar('Restaurar backup?', `${data.equip.length} equipamento(s) e ${data.fotos?.length || 0} foto(s). Itens com o mesmo ID serão substituídos; os demais são mantidos.`, 'Restaurar'))) return;
  for (const e of data.equip) await dbPut('equip', e);
  for (const f of data.fotos || []) {
    const blob = await (await fetch(f.blob)).blob();
    await dbPut('fotos', { ...f, blob });
  }
  state.equip = await dbAll('equip');
  toast('Backup restaurado');
  render();
}

// ---------------------------------------------------------------- ajustes
async function abrirAjustes() {
  let uso = '';
  if (navigator.storage?.estimate) {
    const { usage, quota } = await navigator.storage.estimate();
    uso = `${(usage / 1048576).toFixed(1)} MB usados de ${(quota / 1048576).toFixed(0)} MB`;
  }
  const persist = navigator.storage?.persisted ? await navigator.storage.persisted() : false;
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  abrirModal(`
    <h2>Ajustes</h2>
    ${!standalone ? `<div class="banner warn small mt">📲 Para usar como app: no Safari toque em Compartilhar → “Adicionar à Tela de Início”. Instalado, os dados ficam protegidos contra limpeza automática do navegador.</div>` : ''}
    <div class="field mt"><label>Alertar com quantos dias de antecedência</label><input type="number" id="cfg-dias" inputmode="numeric" min="0" max="60" value="${state.cfg.alertaDias}"></div>
    <div class="switch"><div><b>Notificações</b><div class="muted small">Aviso diário ao abrir o app, e contador no ícone.</div></div>
      <button class="btn sm ${state.cfg.notificar ? 'primary' : 'outline'}" data-ativar-notif>${state.cfg.notificar ? 'Ativadas' : 'Ativar'}</button></div>
    <div class="switch"><div><b>Calendário do celular</b><div class="muted small">Lembretes que disparam mesmo com o app fechado.</div></div>
      <button class="btn sm outline" data-ics-todos>Exportar</button></div>
    <div class="sec-title">Dados</div>
    <p class="muted small">Os dados ficam só neste aparelho. ${uso} · Armazenamento ${persist ? 'persistente ✅' : 'não persistente ⚠️'}. Faça backup periodicamente.</p>
    <div class="sheet-actions">
      <button class="btn outline block" data-backup>⬇ Exportar backup (com fotos)</button>
      <label class="btn outline block">⬆ Restaurar backup<input type="file" accept="application/json,.json" id="imp" hidden></label>
      <button class="btn outline block" data-csv>⬇ Exportar planilha (CSV)</button>
      <button class="btn primary block" data-fechar>Fechar</button>
    </div>
    <p class="muted small mt" style="text-align:center">CMR Locações · v1.0</p>`, {
    onMount: (s) => {
      $('#cfg-dias', s).addEventListener('change', async (ev) => {
        state.cfg.alertaDias = Math.min(60, Math.max(0, parseInt(ev.target.value, 10) || 0));
        await salvarCfg(); render();
      });
      $('#imp', s).addEventListener('change', (ev) => { const f = ev.target.files[0]; if (f) { fecharModal(); importarBackup(f); } });
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
  await salvarCfg();
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
    await salvarCfg();
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
  if ('backup' in ds) return exportarBackup();
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
    e.renovacoes = e.renovacoes.slice(0, -1); e.fim = r.de;
    await salvarEquip(e); toast('Renovação desfeita'); render(); return;
  }
  if (ds.reabrir) {
    const e = state.equip.find((x) => x.id === ds.reabrir);
    if (!(await confirmar('Reabrir locação?', 'O equipamento volta para a lista de ativos.', 'Reabrir'))) return abrirDetalhe(e.id);
    e.status = 'ativo'; e.devolucao = null;
    await salvarEquip(e); toast('Locação reaberta'); render(); return;
  }
  if (ds.open && !ev.target.closest('.thumbs')) return abrirDetalhe(ds.open);
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
document.addEventListener('visibilitychange', () => { if (!document.hidden && db) { if (!$('#modal-root').innerHTML) render(); notificarAlertas(); } });

// ---------------------------------------------------------------- init
(async function init() {
  try {
    db = await abrirDB();
    state.equip = await dbAll('equip');
    state.cfg = { ...CFG_PADRAO, ...((await dbGet('kv', 'cfg')) || {}) };
  } catch (err) {
    console.error(err);
    $('#view').innerHTML = '<div class="empty"><div class="big">⚠️</div><p>Não foi possível abrir o banco de dados local. Verifique se o navegador não está em modo privado.</p></div>';
    return;
  }
  const inicial = new URLSearchParams(location.search).get('v');
  if (inicial && ['inicio', 'agenda', 'relatorios', 'equipamentos'].includes(inicial)) state.view = inicial;
  render();
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW', e));
  }
  notificarAlertas();
})();
