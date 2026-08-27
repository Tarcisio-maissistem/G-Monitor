// Coletor do portal GetCard (relatoriodevendas.com.br) — ver openspec D26/D29.
//
// O portal NAO tem API. O botao "CSV" e do DataTables (monta o arquivo no navegador), mas a
// TABELA vem renderizada pelo servidor — entao a coleta e HTTP puro, sem navegador headless
// no VPS. Fluxo validado ponta a ponta em 27/08 com a conta do dono.
const BASE = 'https://relatoriodevendas.com.br/index.php';

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

/**
 * Baixa as transacoes do periodo. Lanca CredencialInvalida quando o portal devolve a tela de
 * login em vez do relatorio — NUNCA devolve lista vazia nesse caso: "vazio" seria lido como
 * "a adquirente nao repassou nada" e acusaria a adquirente injustamente (D25).
 */
export async function coletar(opts: {
  user: string; password: string; from: string; to: string; maxPaginas?: number;
}): Promise<{ linhas: GetcardRow[]; paginas: number }> {
  const cookies = new Map<string, string>();
  const jar = (): string => [...cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  const guardar = (r: Response): void => {
    for (const c of r.headers.getSetCookie?.() ?? []) {
      const kv = c.split(';')[0] ?? '';
      const i = kv.indexOf('=');
      if (i > 0) cookies.set(kv.slice(0, i), kv.slice(i + 1));
    }
  };
  const get = async (url: string): Promise<string> => {
    const r = await fetch(url, { headers: { cookie: jar() }, redirect: 'follow' });
    guardar(r); return r.text();
  };
  const post = async (url: string, body: URLSearchParams): Promise<string> => {
    const r = await fetch(url, {
      method: 'POST', redirect: 'follow',
      headers: { cookie: jar(), 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    guardar(r); return r.text();
  };

  // 1) pagina de login -> cookie CSRF + token
  let html = await get(`${BASE}/admin/a/login?code=GETCARD`);
  // 2) autentica
  html = await post(`${BASE}/admin/a/login?code=GETCARD`, new URLSearchParams({
    csrf_test_name: csrfDo(html), user: opts.user, password: opts.password,
  }));
  // 3) tela do relatorio (traz um CSRF novo)
  html = await get(`${BASE}/admin/vendas/filtroTodasAsVendas`);
  if (/name="password"/.test(html)) throw new CredencialInvalida();

  const periodo = `${ddmmaaaa(opts.from)} - ${ddmmaaaa(opts.to)}`;
  html = await post(`${BASE}/admin/vendas/filtroTodasAsVendas`, new URLSearchParams({
    csrf_test_name: csrfDo(html), periodo, numeroRegistro: '100',
  }));
  if (/name="password"/.test(html)) throw new CredencialInvalida();

  let linhas = parseLinhas(html);
  const paginas = Math.min(totalPaginas(html), opts.maxPaginas ?? 60);

  // Paginas 2..N em blocos de 4 em paralelo. Sequencial com 200ms de pausa levava ~90s no mes
  // inteiro (29 paginas) e estourava o tempo do gateway; em blocos cai pra ~20s. 4 e um meio
  // termo deliberado: acelera sem martelar o portal do fornecedor.
  const LOTE = 4;
  const urlDa = (p: number): string =>
    `${BASE}/admin/vendas/filtroTodasAsVendas?&periodo=${encodeURIComponent(periodo)}`
    + `&numeroRegistro=100&ordernar2=crescente&ordernar1=nsu&page=${p}`;

  for (let inicio = 2; inicio <= paginas; inicio += LOTE) {
    const bloco: number[] = [];
    for (let p = inicio; p < inicio + LOTE && p <= paginas; p++) bloco.push(p);
    const htmls = await Promise.all(bloco.map((p) => get(urlDa(p))));
    for (const h of htmls) linhas = linhas.concat(parseLinhas(h));
  }
  return { linhas, paginas };
}
