import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { formatBRL, parseCurrency } from '../../lib/masks';
import { useAuthStore } from '../../stores/authStore';
import { useToast } from '../Toast';
import { MaskedInput } from '../MaskedInput';

interface MetaResp {
  year: number;
  month: number;
  goal: number;
  achieved: number;
  remaining: number;
  progressPct: number;
  pacePct: number;
  sales: number;
  totalDays: number;
  elapsedDays: number;
}

// Meta mensal DENTRO do dashboard (pedido do dono 01/09: a guia separada saiu do menu; a
// configuração do valor mora no cadastro da empresa). Mostra a barra de progresso, o
// comparativo com o MESMO PONTO do mês anterior (incentivo) e, ao bater a meta, solta
// fogos + confete UMA vez por mês (marcado em localStorage por empresa+mês).
export function MetaSection(): JSX.Element | null {
  const user = useAuthStore((s) => s.user);
  const activeTenantId = useAuthStore((s) => s.activeTenantId);
  const tenantKey = activeTenantId ?? user?.email ?? 'anon';
  const hoje = useMemo(() => new Date(), []);
  const year = hoje.getFullYear();
  const month = hoje.getMonth() + 1;
  const anterior = month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };

  const meta = useQuery({
    queryKey: ['monthly-goal', year, month],
    queryFn: () => api<MetaResp>(`/api/reports/monthly-goal?year=${year}&month=${month}`),
  });
  // Mês anterior CORTADO no mesmo dia de hoje: compara "onde eu estava no mesmo ponto".
  const mesPassado = useQuery({
    queryKey: ['monthly-goal', anterior.year, anterior.month, hoje.getDate()],
    queryFn: () => api<MetaResp>(`/api/reports/monthly-goal?year=${anterior.year}&month=${anterior.month}&uptoDay=${hoje.getDate()}`),
  });

  const m = meta.data;
  const prev = mesPassado.data;
  const bateu = !!m && m.goal > 0 && m.achieved >= m.goal;

  // Comemoração: uma vez por empresa por mês. localStorage pode lançar (modo privado etc.)
  const chave = `metaComemorada:${tenantKey}:${year}-${String(month).padStart(2, '0')}`;
  const [comemorar, setComemorar] = useState(false);
  useEffect(() => {
    if (!bateu) return;
    try {
      if (localStorage.getItem(chave)) return;
      localStorage.setItem(chave, new Date().toISOString());
    } catch {
      // sem localStorage, comemora mesmo assim (no máximo repete noutra visita)
    }
    setComemorar(true);
    const t = setTimeout(() => setComemorar(false), 8000);
    return () => clearTimeout(t);
  }, [bateu, chave]);

  if (meta.isLoading) return null;
  if (!m) return null;

  const podeEditar = (user?.isSuperAdmin ?? false) || user?.role === 'admin';
  if (m.goal <= 0) {
    // Sem meta configurada: convite discreto (a configuração fica no cadastro da empresa).
    return (
      <section className="bg-white rounded-xl shadow-sm border p-4 text-sm text-slate-500 flex items-center justify-between gap-3">
        <span>🎯 Defina a meta mensal de faturamento no cadastro da empresa para acompanhar o progresso aqui.</span>
        {podeEditar && <EditarMeta atual={0} />}
      </section>
    );
  }

  const pct = Math.min(100, m.progressPct);
  const diasRestantes = Math.max(0, m.totalDays - m.elapsedDays);
  const porDia = diasRestantes > 0 && m.remaining > 0 ? m.remaining / diasRestantes : 0;
  // Incentivo vs mês anterior no MESMO ponto (só quando o mês passado teve venda medida)
  const comparativo = prev && prev.achieved > 0
    ? ((m.achieved - prev.achieved) / prev.achieved) * 100
    : null;

  return (
    <section className="bg-white rounded-xl shadow-sm border p-5 relative overflow-hidden">
      {comemorar && <Fogos />}
      <div className="flex items-center justify-between mb-2 gap-2">
        <h3 className="font-semibold text-slate-700">🎯 Meta do mês</h3>
        <div className="flex items-center gap-3">
          <span className={`text-sm font-semibold ${bateu ? 'text-emerald-600' : 'text-slate-600'}`}>
            {formatBRL(m.achieved)} de {formatBRL(m.goal)} ({m.progressPct.toFixed(0)}%)
          </span>
          {podeEditar && <EditarMeta atual={m.goal} />}
        </div>
      </div>
      <div className="w-full h-4 bg-slate-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-700 ${bateu ? 'bg-emerald-500' : m.progressPct >= m.pacePct ? 'bg-blue-500' : 'bg-amber-500'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="mt-2 text-sm space-y-1">
        {bateu ? (
          <div className="text-emerald-700 font-medium">🏆 Meta batida! Tudo daqui pra frente é lucro por cima do planejado.</div>
        ) : (
          <div className="text-slate-600">
            Faltam <strong>{formatBRL(m.remaining)}</strong>
            {porDia > 0 && <> — {formatBRL(porDia)}/dia nos {diasRestantes} dias restantes</>}.
          </div>
        )}
        {comparativo !== null && (
          <div className={comparativo >= 0 ? 'text-emerald-700' : 'text-amber-700'}>
            {comparativo >= 0 ? '📈' : '📉'} Você está{' '}
            <strong>{Math.abs(comparativo).toFixed(1)}% {comparativo >= 0 ? 'acima' : 'abaixo'}</strong>{' '}
            do mesmo ponto do mês passado ({formatBRL(prev!.achieved)} até o dia {hoje.getDate()}).
          </div>
        )}
      </div>
    </section>
  );
}

// Lápis + campo de valor: o super-admin também pode ajustar direto daqui (grava no cadastro
// da empresa ativa via /api/tenant/settings — mesmo lugar que a tela Empresas usa).
function EditarMeta({ atual }: { atual: number }): JSX.Element {
  const [aberto, setAberto] = useState(false);
  const [valor, setValor] = useState('');
  const toast = useToast();
  const queryClient = useQueryClient();
  const salvar = useMutation({
    mutationFn: (novo: number) => api('/api/tenant/settings', { method: 'PATCH', body: JSON.stringify({ monthlyGoal: novo }) }),
    onSuccess: () => {
      toast.push({ type: 'success', message: 'Meta salva!' });
      queryClient.invalidateQueries({ queryKey: ['monthly-goal'] });
      setAberto(false);
      setValor('');
    },
    onError: (err: Error) => toast.push({ type: 'error', message: err.message }),
  });
  if (!aberto) {
    return (
      <button onClick={() => setAberto(true)} className="text-slate-400 hover:text-blue-600 text-sm" title="Editar meta" aria-label="Editar meta">
        ✎
      </button>
    );
  }
  return (
    <span className="flex items-center gap-1">
      <MaskedInput
        mask="currency"
        prefix="R$"
        placeholder={atual > 0 ? formatBRL(atual) : '50.000,00'}
        value={valor}
        onChange={setValor}
        className="w-32 border rounded px-2 py-1 text-sm"
      />
      <button
        onClick={() => { const v = parseCurrency(valor); if (v >= 0) salvar.mutate(v); }}
        disabled={salvar.isPending || !valor}
        className="bg-blue-600 text-white px-2 py-1 rounded text-xs disabled:opacity-50"
      >
        {salvar.isPending ? '...' : 'OK'}
      </button>
      <button onClick={() => setAberto(false)} className="text-slate-400 text-sm px-1" aria-label="Cancelar">×</button>
    </span>
  );
}

// Fogos de artifício + confete em canvas, sem biblioteca (~8s). Fica por cima da seção
// inteira via position:fixed; pointer-events:none não atrapalha nenhum clique.
function Fogos(): JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    const cores = ['#f59e0b', '#10b981', '#3b82f6', '#ef4444', '#a855f7', '#eab308'];
    type P = { x: number; y: number; vx: number; vy: number; cor: string; vida: number; tipo: 'confete' | 'faisca'; rot: number };
    const parts: P[] = [];
    // confete caindo do topo
    for (let i = 0; i < 140; i++) {
      parts.push({
        x: Math.random() * canvas.width, y: -Math.random() * canvas.height * 0.5,
        vx: (Math.random() - 0.5) * 1.5, vy: 2 + Math.random() * 3,
        cor: cores[i % cores.length]!, vida: 1, tipo: 'confete', rot: Math.random() * Math.PI,
      });
    }
    // explosões de fogos em momentos diferentes
    const explodir = (): void => {
      const cx = canvas.width * (0.15 + Math.random() * 0.7);
      const cy = canvas.height * (0.15 + Math.random() * 0.4);
      const cor = cores[Math.floor(Math.random() * cores.length)]!;
      for (let i = 0; i < 60; i++) {
        const ang = (Math.PI * 2 * i) / 60;
        const vel = 2 + Math.random() * 4;
        parts.push({ x: cx, y: cy, vx: Math.cos(ang) * vel, vy: Math.sin(ang) * vel, cor, vida: 1, tipo: 'faisca', rot: 0 });
      }
    };
    const timers = [0, 900, 1900, 3100, 4500].map((ms) => setTimeout(explodir, ms));
    let vivo = true;
    let raf = 0;
    const desenhar = (): void => {
      if (!vivo) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const p of parts) {
        if (p.vida <= 0) continue;
        p.x += p.vx; p.y += p.vy;
        if (p.tipo === 'faisca') { p.vy += 0.05; p.vida -= 0.012; } else { p.rot += 0.08; p.vida -= 0.003; }
        ctx.globalAlpha = Math.max(0, p.vida);
        ctx.fillStyle = p.cor;
        if (p.tipo === 'confete') {
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillRect(-4, -2, 8, 4); ctx.restore();
        } else {
          ctx.beginPath(); ctx.arc(p.x, p.y, 2, 0, Math.PI * 2); ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(desenhar);
    };
    desenhar();
    return () => { vivo = false; cancelAnimationFrame(raf); timers.forEach(clearTimeout); };
  }, []);
  return <canvas ref={ref} className="fixed inset-0 z-[80] pointer-events-none" aria-hidden />;
}
