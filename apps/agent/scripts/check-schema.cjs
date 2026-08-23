// Diagnostico standalone: detecta o schema financeiro real do GDOOR (CONTAS_PAGAR/CONTAS_RECEBER
// x PAGAR/RECEBER) e confirma colunas do ESTOQUE. So le, nunca escreve. Roda com node puro,
// sem precisar buildar o resto do monorepo (nao depende de better-sqlite3, que precisa de
// Visual Studio Build Tools pra compilar se nao houver prebuild pra versao do Node do cliente).
//
// Uso: node check-schema.cjs "<caminho\\pro\\banco.FDB>" [usuario] [senha] [host] [porta]
// Ex.:  node check-schema.cjs "C:\GDOOR Sistemas\GDOOR PRO\DATAGES.FDB" SYSDBA masterkey
const Firebird = require('node-firebird');

const [, , database, user = 'SYSDBA', password = 'masterkey', host = '127.0.0.1', port = '3050'] = process.argv;

if (!database) {
  console.error('Uso: node check-schema.cjs "<caminho\\\\pro\\\\banco.FDB>" [usuario] [senha] [host] [porta]');
  process.exit(1);
}

const options = {
  host,
  port: Number(port),
  database,
  user,
  password,
  lowercase_keys: true,
  role: '',
  pageSize: 4096,
};

function query(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.query(sql, params, (err, result) => {
      if (err) return reject(err);
      resolve(result);
    });
  });
}

async function tableExists(db, name) {
  const rows = await query(db, "SELECT COUNT(*) AS CNT FROM RDB$RELATIONS WHERE UPPER(TRIM(RDB$RELATION_NAME)) = ?", [name.toUpperCase()]);
  return Number(rows[0].cnt) > 0;
}

async function columns(db, name) {
  const rows = await query(db, `
    SELECT TRIM(RF.RDB$FIELD_NAME) AS NOME
    FROM RDB$RELATION_FIELDS RF
    WHERE RF.RDB$RELATION_NAME = ?
    ORDER BY RF.RDB$FIELD_POSITION
  `, [name.toUpperCase()]);
  return rows.map((r) => r.nome);
}

Firebird.attach(options, async (err, db) => {
  if (err) {
    console.error('ERRO AO CONECTAR:', err.message);
    process.exit(1);
  }
  try {
    console.log('=== CONTAS A PAGAR / RECEBER ===');
    for (const t of ['CONTAS_PAGAR', 'CONTAS_RECEBER', 'PAGAR', 'RECEBER']) {
      const exists = await tableExists(db, t);
      console.log(t, '->', exists ? 'EXISTE' : 'nao existe');
      if (exists) {
        const cols = await columns(db, t);
        console.log('  colunas:', cols.join(', '));
      }
    }

    console.log('\n=== ESTOQUE ===');
    const hasEstoque = await tableExists(db, 'ESTOQUE');
    console.log('ESTOQUE ->', hasEstoque ? 'EXISTE' : 'nao existe');
    if (hasEstoque) {
      const cols = await columns(db, 'ESTOQUE');
      console.log('  colunas:', cols.join(', '));
    }

    console.log('\n=== CLIENTE / CLIENTES ===');
    for (const t of ['CLIENTE', 'CLIENTES']) {
      const exists = await tableExists(db, t);
      console.log(t, '->', exists ? 'EXISTE' : 'nao existe');
    }

    console.log('\n=== VENDAS (amostra rapida) ===');
    const vendas = await query(db, 'SELECT COUNT(*) AS QTD FROM VENDAS');
    console.log('total de linhas em VENDAS:', vendas[0].qtd);
  } catch (e) {
    console.error('ERRO NA QUERY:', e.message);
  } finally {
    db.detach();
  }
});
