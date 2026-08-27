import { describe, it, expect } from 'vitest';
import { parseLinhas, separarAdquirente, valorBr, dataHoraBr, totalPaginas } from './getcard.js';

// Linhas REAIS do portal (coletadas em 27/08 com a conta do dono) — se o portal mudar o
// layout, este teste quebra antes de a conciliacao mentir em producao.
const HTML_REAL = `<table><tbody>
<tr role="row"><td>1</td><td>001</td><td>001001</td><td>650597-2974Crédito à Vista</td><td>Chip</td><td>1</td><td>84,12</td><td>CIELOELO CREDITO</td><td>06/08/2026</td><td>06/08/2026 16:01:51</td><td>08600101009</td><td></td><td>554523</td><td>Autorizadas000</td></tr>
<tr role="row"><td>2</td><td>002</td><td>002319</td><td>111111-2222Crédito à Vista</td><td>Chip</td><td>1</td><td>567,80</td><td>CIELOELO CREDITO</td><td>22/08/2026</td><td>22/08/2026 11:08:43</td><td>08600101010</td><td></td><td>684385</td><td>Autorizadas000</td></tr>
<tr role="row"><td>3</td><td>001</td><td>001002</td><td>543903-1255Débito à Vista</td><td>Contactless</td><td>1</td><td>1.234,56</td><td>REDEMASTERCARD DEB</td><td>06/08/2026</td><td>06/08/2026 16:22:48</td><td>08600201007</td><td>511210380</td><td>791711</td><td>Negadas051</td></tr>
</tbody></table>`;

describe('getcard parser', () => {
  it('le as 14 colunas de uma linha real', () => {
    const r = parseLinhas(HTML_REAL);
    expect(r).toHaveLength(3);
    expect(r[0]).toMatchObject({
      pdv: '001', nsu: '001001', valor: 84.12, adquirente: 'CIELO', bandeira: 'ELO CREDITO',
      data: '2026-08-06', hora: '16:01:51', autorizacao: '554523', autorizada: true,
    });
  });

  it('usa D/H Estabelecimento (col 9), nao Data da Msg (col 8) — D29', () => {
    // se pegasse a col 8 a hora viria vazia; a data certa e a que casa com o GDOOR
    expect(parseLinhas(HTML_REAL)[1]).toMatchObject({ data: '2026-08-22', hora: '11:08:43' });
  });

  it('marca nao-autorizada como autorizada=false', () => {
    expect(parseLinhas(HTML_REAL)[2]!.autorizada).toBe(false);
  });

  it('separa adquirente da bandeira, que vem grudada', () => {
    expect(separarAdquirente('CIELOELO CREDITO')).toEqual({ adquirente: 'CIELO', bandeira: 'ELO CREDITO' });
    expect(separarAdquirente('REDEMASTERCARD DEB')).toEqual({ adquirente: 'REDE', bandeira: 'MASTERCARD DEB' });
    expect(separarAdquirente('OUTRACOISA')).toEqual({ adquirente: '', bandeira: 'OUTRACOISA' });
  });

  it('le valor no formato brasileiro, inclusive com milhar', () => {
    expect(valorBr('84,12')).toBe(84.12);
    expect(valorBr('1.234,56')).toBe(1234.56);
    expect(valorBr('')).toBe(0);
  });

  it('converte data/hora br pra ISO', () => {
    expect(dataHoraBr('22/08/2026 11:08:43')).toEqual({ data: '2026-08-22', hora: '11:08:43' });
    expect(dataHoraBr('22/08/2026')).toEqual({ data: '2026-08-22', hora: '' });
    expect(dataHoraBr('lixo')).toEqual({ data: '', hora: '' });
  });

  it('acha o total de paginas e assume 1 quando nao ha paginacao', () => {
    expect(totalPaginas('<a href="?page=2">2</a><a href="?page=29">Último</a>')).toBe(29);
    expect(totalPaginas('<table></table>')).toBe(1);
  });

  it('ignora HTML sem tabela em vez de estourar', () => {
    expect(parseLinhas('<html>login</html>')).toEqual([]);
  });
});
