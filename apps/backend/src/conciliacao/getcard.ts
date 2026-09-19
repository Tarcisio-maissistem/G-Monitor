// Coletor do portal GetCard (relatoriodevendas.com.br) — ver openspec D26/D29.
//
// O portal NAO tem API. O botao "CSV" e do DataTables (monta o arquivo no navegador), mas a
// TABELA vem renderizada pelo servidor — entao a coleta e HTTP puro, sem navegador headless
// no VPS. Fluxo validado ponta a ponta em 27/08 com a conta do dono.
// Portal "Scope" (setembro/2026): o endereco perdeu o prefixo /index.php/admin, o login
// deixou de ter CSRF e a busca virou GET com o periodo na URL. As paginas (e a tabela) sao
// as mesmas. Em 19/09 o coletor antigo recebia 404 e devolvia ZERO transacoes em silencio.
const BASE = 'https://relatoriodevendas.com.br';

export interface GetcardRow {
  pdv: string;
  nsu: string;
  cartao: string;
  parcelas: number;
  valor: number;
  adquirente: string; // CIELO | REDE | ...
  bandeira: string;
  /** 'YYYY-MM-DD' vindo de "D/H Estabelecimento" — NAO de "Data da Msg" (D29) */
  data: string;
  hora: string;
  nsuHost: string;
  autorizacao: string;
  status: string;
  autorizada: boolean;
}

// Adquirente e bandeira vem GRUDADOS, sem separador: "CIELOELO CREDITO", "REDEMASTERCARD DEB".
// So da pra separar por prefixo conhecido — lista aberta, o resto cai em adquirente vazio.
const ADQUIRENTES = ['CIELO', 'REDE', 'STONE', 'GETNET', 'SHIPAY', 'PAGSEGURO', 'SAFRA'];

export function separarAdquirente(raw: string): { adquirente: string; bandeira: string } {
  const t = (raw || '').trim();
  const up = t.toUpperCase();
  const achou = ADQUIRENTES.find((a) => up.startsWith(a));
  return achou ? { adquirente: achou, bandeira: t.slice(achou.length).trim() } : { adquirente: '', bandeira: t };
}

// "1.234,56" -> 1234.56
export function valorBr(raw: string): number {
  return Number(String(raw ?? '').replace(/\./g, '').replace(',', '.')) || 0;
}

// "22/08/2026 11:08:43" -> { data: '2026-08-22', hora: '11:08:43' }
export function dataHoraBr(raw: string): { data: string; hora: string } {
  const m = String(raw ?? '').match(/(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}:\d{2}:\d{2}))?/);
  if (!m) return { data: '', hora: '' };
  return { data: `${m[3]}-${m[2]}-${m[1]}`, hora: m[4] ?? '' };
}

const semTags = (s: string): string => s.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim();

/** Le as linhas da tabela do relatorio. Funcao PURA — testada com HTML real do portal. */
export function parseLinhas(html: string): GetcardRow[] {
  const tb = html.match(/<tbody[\s\S]*?<\/tbody>/);
  if (!tb) return [];
  const out: GetcardRow[] = [];
  for (const tr of tb[0].match(/<tr[\s\S]*?<\/tr>/g) ?? []) {
    const td = (tr.match(/<td[\s\S]*?<\/td>/g) ?? []).map(semTags);
    if (td.length < 14) continue;
    const { adquirente, bandeira } = separarAdquirente(td[7]!);
    // col 9 = "D/H Estabelecimento" (a data que casa com o GDOOR); col 8 = "Data da Msg" (D29)
    const { data, hora } = dataHoraBr(td[9]!);
    out.push({
      pdv: td[1]!, nsu: td[2]!, cartao: td[3]!, parcelas: Number(td[5]) || 1,
      valor: valorBr(td[6]!), adquirente, bandeira, data, hora,
      nsuHost: td[11]!, autorizacao: td[12]!, status: td[13]!,
      autorizada: /autorizad/i.test(td[13]!),
    });
  }
  return out;
}

/** Ultima pagina do bloco de paginacao (1 quando nao ha paginacao). */
export function totalPaginas(html: string): number {
  const ns = [...html.matchAll(/page=(\d+)/g)].map((m) => Number(m[1]));
  return ns.length ? Math.max(...ns) : 1;
}

const csrfDo = (html: string): string => (html.match(/name="csrf_test_name" value="([a-f0-9]+)"/) ?? [])[1] ?? '';
const ddmmaaaa = (iso: string): string => { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; };

export class CredencialInvalida extends Error {
  constructor() { super('credencial_invalida'); this.name = 'CredencialInvalida'; }
}

/** O portal respondeu algo que NAO e a tabela de vendas (404, pagina nova, manutencao). */
export class PortalMudou extends Error {
  constructor(detalhe: string) { super(`portal_mudou: ${detalhe}`); this.name = 'PortalMudou'; }
}

// A pagina do relatorio SEMPRE traz o cabecalho da tabela, mesmo sem nenhuma venda no periodo.
// Sem ele, a resposta nao e o relatorio — e tratar isso como "zero vendas" acusaria a adquirente
// de nao ter repassado nada (D25). Por isso falha alto em vez de devolver lista vazia.
export const ehRelatorio = (html: string): boolean => /<th[^>]*>\s*NSU\s*<\/th>/i.test(html);

/**
 * Abre UMA sessao no portal e devolve um "listar(periodo)" reutilizavel — o cache por dia busca
 * varios dias soltos sem refazer o login a cada um. Lanca CredencialInvalida quando o portal
 * devolve a tela de login e PortalMudou quando a resposta nao e o relatorio: NUNCA devolve lista
 * vazia nesses casos ("vazio" acusaria a adquirente de nao ter repassado nada — D25).
 */
export async function sessaoPortal(opts: { user: string; password: string; maxPaginas?: number }): Promise<{
  listar: (from: string, to: string) => Promise<{ linhas: GetcardRow[]; paginas: number }>;
}> {
  const cookies = new Map<string, string>();
  const jar = (): string => [...cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  const guardar = (r: Response): void => {
    for (const c of r.headers.getSetCookie?.() ?? []) {
      const kv = c.split(';')[0] ?? '';
      const i = kv.indexOf('=');
      if (i > 0) cookies.set(kv.slice(0, i), kv.slice(i + 1));
    }
  };
  // O portal as vezes derruba a conexao (visto 19/09: "fetch failed: read ETIMEDOUT" com volume
  // alto no dia). Queda de REDE tenta de novo ate 3x com espera crescente; resposta HTTP recebida
  // (mesmo errada) nao repete — essa quem julga e o ehRelatorio/CredencialInvalida.
  const get = async (url: string): Promise<string> => {
    for (let tentativa = 1; ; tentativa++) {
      try {
        const r = await fetch(url, { headers: { cookie: jar() }, redirect: 'follow', signal: AbortSignal.timeout(45_000) });
        guardar(r); return await r.text();
      } catch (err) {
        if (tentativa >= 3) throw err;
        await new Promise((ok) => setTimeout(ok, 2_000 * tentativa));
      }
    }
  };
  const post = async (url: string, body: URLSearchParams): Promise<string> => {
    const r = await fetch(url, {
      method: 'POST', redirect: 'follow',
      headers: { cookie: jar(), 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    guardar(r); return r.text();
  };

  // 1) pagina de login (cookie de sessao; CSRF so se o portal ainda mandar)
  let html = await get(`${BASE}/a/login?code=GETCARD`);
  // 2) autentica — o portal novo nao usa CSRF, mas mandar quando existe nao atrapalha
  const login = new URLSearchParams({ user: opts.user, password: opts.password });
  const csrf = csrfDo(html);
  if (csrf) login.set('csrf_test_name', csrf);
  html = await post(`${BASE}/a/login?code=GETCARD`, login);
  if (/name="password"/.test(html)) throw new CredencialInvalida();

  const listar = async (from: string, to: string): Promise<{ linhas: GetcardRow[]; paginas: number }> => {
    // 3) relatorio do periodo: GET com os filtros na URL (antes era POST com CSRF)
    const periodo = `${ddmmaaaa(from)} - ${ddmmaaaa(to)}`;
    const urlDa = (p: number): string =>
      `${BASE}/vendas/filtroTodasAsVendas?nsu=&pdv=&periodo=${encodeURIComponent(periodo)}`
      + `&numeroRegistro=100&ordernar2=crescente&ordernar1=nsu${p > 1 ? `&page=${p}` : ''}`;
    const primeira = await get(urlDa(1));
    if (/name="password"/.test(primeira)) throw new CredencialInvalida();
    if (!ehRelatorio(primeira)) throw new PortalMudou(`pagina de vendas sem a tabela (${primeira.length} bytes)`);

    let linhas = parseLinhas(primeira);
    const paginas = Math.min(totalPaginas(primeira), opts.maxPaginas ?? 60);
    // Paginas 2..N em blocos de 4 em paralelo: acelera sem martelar o portal do fornecedor.
    const LOTE = 4;
    for (let inicio = 2; inicio <= paginas; inicio += LOTE) {
      const bloco: number[] = [];
      for (let p = inicio; p < inicio + LOTE && p <= paginas; p++) bloco.push(p);
      const htmls = await Promise.all(bloco.map((p) => get(urlDa(p))));
      for (const h of htmls) {
        // pagina do meio que vem sem a tabela = extrato incompleto; nunca somar pela metade
        if (!ehRelatorio(h)) throw new PortalMudou('pagina intermediaria sem a tabela');
        linhas = linhas.concat(parseLinhas(h));
      }
    }
    return { linhas, paginas };
  };
  return { listar };
}

/** Atalho de uma consulta so (login + um periodo). */
export async function coletar(opts: {
  user: string; password: string; from: string; to: string; maxPaginas?: number;
}): Promise<{ linhas: GetcardRow[]; paginas: number }> {
  const s = await sessaoPortal(opts);
  return s.listar(opts.from, opts.to);
}
