// ════════════════════════════════════════════════════════════════
// Locações CMR — API dos equipamentos locados em obra.
// Mesmo login do Sistema RH / Efetivo (token emitido por /api/auth).
// Dados em cmr-locacoes.json e fotos em cmr-locacoes/fotos/<id>/ no
// mesmo Vercel Blob do projeto. Não altera nada do RH nem do Efetivo.
//
// POST /api/locacoes  {token, action, ...}
//   carregar                         → {locacoes}
//   salvar        {locacao}          → {locacao}   (cria ou atualiza pelo id)
//   excluir       {id}               → {ok}
//   foto-enviar   {id, tipo, imagem} → {locacao}   (imagem = data URL JPEG)
//   foto-remover  {id, path}         → {locacao}
// GET  /api/locacoes?foto=<path>&t=<token>  → a imagem (blob privado)
// ════════════════════════════════════════════════════════════════
const crypto = require('crypto');
const { put, get, del } = require('@vercel/blob');

// Mesmo segredo e mesmo formato do api/auth.js.
const JWT_SECRET = process.env.CMR_JWT_SECRET || 'cmr-rh-secret-2026';
const ARQUIVO    = process.env.CMR_LOCACOES_PATH || 'cmr-locacoes.json';
const PASTA_FOTOS = 'cmr-locacoes/fotos/';
let ACESSO = process.env.CMR_BLOB_ACCESS || 'private';

const PERIODOS = ['diaria', 'semanal', 'quinzenal', 'mensal'];
const TIPOS_FOTO = ['recebimento', 'entrega'];
const MAX_FOTO = 3 * 1024 * 1024; // 3 MB já comprimido no celular

// ── JWT (HS256, igual ao api/auth.js) ──
function base64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function verificarToken(token) {
  try {
    const [h, b, s] = String(token || '').split('.');
    if (!h || !b || !s) return null;
    const esperado = base64url(crypto.createHmac('sha256', JWT_SECRET).update(h + '.' + b).digest());
    const a = Buffer.from(s), e = Buffer.from(esperado);
    if (a.length !== e.length || !crypto.timingSafeEqual(a, e)) return null;
    const payload = JSON.parse(Buffer.from(b, 'base64').toString());
    if (payload.exp) {
      const expMs = payload.exp > 1e12 ? payload.exp : payload.exp * 1000;
      if (Date.now() > expMs) return null;
    }
    return payload;
  } catch { return null; }
}

// ── Blob ──
async function lerBlob(caminho) {
  const r = await get(caminho, { access: ACESSO, useCache: false });
  if (!r || r.statusCode !== 200) return null;
  return r;
}
// Se o store for público, a primeira chamada privada falha: troca e repete uma vez.
async function comAcesso(fn) {
  try { return await fn(); }
  catch (err) {
    if (/access/i.test(String(err && err.message)) && ACESSO === 'private') { ACESSO = 'public'; return fn(); }
    throw err;
  }
}
async function carregarBase() {
  const r = await comAcesso(() => lerBlob(ARQUIVO));
  if (!r) return { base: { versao: 1, locacoes: [] }, etag: null };
  const base = JSON.parse(await new Response(r.stream).text());
  if (!Array.isArray(base.locacoes)) base.locacoes = [];
  return { base, etag: r.blob.etag };
}
// Lê → altera → grava com ifMatch. Se outra pessoa gravou no meio, relê e refaz.
async function alterarBase(alteracao) {
  for (let tentativa = 0; tentativa < 4; tentativa++) {
    const { base, etag } = await carregarBase();
    const resultado = await alteracao(base);
    const opcoes = {
      access: ACESSO, contentType: 'application/json', addRandomSuffix: false,
      allowOverwrite: true, cacheControlMaxAge: 60,
    };
    if (etag) opcoes.ifMatch = etag;
    try {
      await comAcesso(() => put(ARQUIVO, JSON.stringify(base), Object.assign(opcoes, { access: ACESSO })));
      return resultado;
    } catch (err) {
      if (/precondition|etag|412/i.test(String(err && (err.name + ' ' + err.message)))) continue;
      throw err;
    }
  }
  throw new Error('Muitas alterações ao mesmo tempo — tente de novo');
}

// ── validação ──
// Erro de dado inválido → 400 (não é falha do servidor).
class ErroValidacao extends Error { constructor(m) { super(m); this.status = 400; } }
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const txt = (v, max = 300) => String(v == null ? '' : v).trim().slice(0, max);
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0; };

function limparLocacao(l, anterior, quem) {
  if (!l || typeof l !== 'object') throw new ErroValidacao('Locação inválida');
  const r = {
    id: txt(l.id, 64),
    nome: txt(l.nome, 120),
    fornecedor: txt(l.fornecedor, 120),
    obraId: txt(l.obraId, 80),
    obraNome: txt(l.obraNome, 160),
    periodo: PERIODOS.includes(l.periodo) ? l.periodo : 'mensal',
    cobranca: l.cobranca === 'cheio' ? 'cheio' : 'proporcional',
    qtd: Math.max(1, Math.min(9999, parseInt(l.qtd, 10) || 1)),
    entrada: txt(l.entrada, 10),
    fim: txt(l.fim, 10),
    valor: Math.max(0, num(l.valor)),
    extras: num(l.extras),
    valorManual: l.valorManual === '' || l.valorManual == null ? '' : num(l.valorManual),
    codigo: txt(l.codigo, 80),
    obs: txt(l.obs, 1000),
    status: l.status === 'devolvido' ? 'devolvido' : 'ativo',
    devolucao: l.status === 'devolvido' ? txt(l.devolucao, 10) : null,
    retirada: l.retirada && ISO.test(l.retirada) ? l.retirada : null,
    renovacoes: Array.isArray(l.renovacoes)
      ? l.renovacoes.slice(-100).filter(x => x && ISO.test(x.de) && ISO.test(x.para)).map(x => ({ em: txt(x.em, 10), de: x.de, para: x.para }))
      : [],
  };
  if (!/^[\w-]{6,64}$/.test(r.id)) throw new ErroValidacao('Identificador inválido');
  if (!r.nome) throw new ErroValidacao('Informe o equipamento');
  if (!ISO.test(r.entrada) || !ISO.test(r.fim)) throw new ErroValidacao('Datas inválidas');
  if (r.fim < r.entrada) throw new ErroValidacao('O fim não pode ser antes da entrada');
  if (r.status === 'devolvido' && (!ISO.test(r.devolucao) || r.devolucao < r.entrada)) throw new ErroValidacao('Data de devolução inválida');
  // Fotos e autoria são do servidor: o app não consegue sobrescrever.
  r.fotos = anterior ? anterior.fotos || [] : [];
  r.criadoEm = anterior ? anterior.criadoEm : new Date().toISOString();
  r.criadoPor = anterior ? anterior.criadoPor : quem;
  r.salvoEm = new Date().toISOString();
  r.salvoPor = quem;
  return r;
}

function corpo(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body || '{}'); } catch { return {}; }
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    // ── foto (GET, para usar direto em <img>) ──
    if (req.method === 'GET') {
      const usuario = verificarToken(req.query && req.query.t);
      if (!usuario) return res.status(401).json({ error: 'Não autorizado' });
      const caminho = String((req.query && req.query.foto) || '');
      if (!caminho.startsWith(PASTA_FOTOS) || caminho.includes('..')) return res.status(400).json({ error: 'Foto inválida' });
      const r = await comAcesso(() => lerBlob(caminho));
      if (!r) return res.status(404).json({ error: 'Foto não encontrada' });
      res.setHeader('Content-Type', r.blob.contentType || 'image/jpeg');
      res.setHeader('Cache-Control', 'private, max-age=86400, immutable');
      return res.status(200).send(Buffer.from(await new Response(r.stream).arrayBuffer()));
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });

    const b = corpo(req);
    const usuario = verificarToken(b.token);
    if (!usuario) return res.status(401).json({ error: 'Sessão expirada — entre de novo' });
    const quem = String(usuario.email || usuario.name || usuario.sub || '').slice(0, 120);

    switch (b.action) {
      case 'carregar': {
        const { base } = await carregarBase();
        return res.json({ locacoes: base.locacoes });
      }

      case 'salvar': {
        const locacao = await alterarBase((base) => {
          const i = base.locacoes.findIndex(x => x.id === (b.locacao && b.locacao.id));
          const nova = limparLocacao(b.locacao, i >= 0 ? base.locacoes[i] : null, quem);
          if (i >= 0) base.locacoes[i] = nova; else base.locacoes.push(nova);
          return nova;
        });
        return res.json({ locacao });
      }

      case 'excluir': {
        const fotos = await alterarBase((base) => {
          const i = base.locacoes.findIndex(x => x.id === b.id);
          if (i < 0) return [];
          const [removida] = base.locacoes.splice(i, 1);
          return (removida.fotos || []).map(f => f.path);
        });
        if (fotos.length) await comAcesso(() => del(fotos)).catch(() => {});
        return res.json({ ok: true });
      }

      case 'foto-enviar': {
        if (!TIPOS_FOTO.includes(b.tipo)) return res.status(400).json({ error: 'Tipo de foto inválido' });
        const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(b.imagem || ''));
        if (!m) return res.status(400).json({ error: 'Imagem inválida' });
        const bin = Buffer.from(m[1], 'base64');
        if (bin.length > MAX_FOTO) return res.status(413).json({ error: 'Foto muito grande' });
        if (!/^[\w-]{6,64}$/.test(String(b.id || ''))) return res.status(400).json({ error: 'Locação inválida' });
        const fotoId = String(b.fotoId || '').match(/^[\w-]{6,64}$/) ? b.fotoId : crypto.randomUUID();
        const caminho = PASTA_FOTOS + b.id + '/' + fotoId + '.jpg';
        // Reenvio da fila (mesmo fotoId) não duplica.
        let jaExiste = false;
        await alterarBase((base) => {
          const l = base.locacoes.find(x => x.id === b.id);
          if (!l) throw new ErroValidacao('Locação não encontrada — salve o equipamento antes');
          jaExiste = (l.fotos || []).some(f => f.path === caminho);
        });
        if (!jaExiste) {
          await comAcesso(() => put(caminho, bin, { access: ACESSO, contentType: 'image/jpeg', addRandomSuffix: false, allowOverwrite: true }));
        }
        const locacao = await alterarBase((base) => {
          const l = base.locacoes.find(x => x.id === b.id);
          if (!l) throw new Error('Locação não encontrada');
          l.fotos = l.fotos || [];
          if (!l.fotos.some(f => f.path === caminho)) {
            l.fotos.push({ path: caminho, tipo: b.tipo, em: new Date().toISOString(), por: quem });
          }
          return l;
        });
        return res.json({ locacao });
      }

      case 'foto-remover': {
        const caminho = String(b.path || '');
        if (!caminho.startsWith(PASTA_FOTOS + b.id + '/')) return res.status(400).json({ error: 'Foto inválida' });
        const locacao = await alterarBase((base) => {
          const l = base.locacoes.find(x => x.id === b.id);
          if (!l) throw new Error('Locação não encontrada');
          l.fotos = (l.fotos || []).filter(f => f.path !== caminho);
          return l;
        });
        await comAcesso(() => del(caminho)).catch(() => {});
        return res.json({ locacao });
      }

      default:
        return res.status(400).json({ error: 'Ação desconhecida' });
    }
  } catch (err) {
    console.error('locacoes', err);
    return res.status(err.status || 500).json({ error: err.message || 'Erro no servidor' });
  }
};
