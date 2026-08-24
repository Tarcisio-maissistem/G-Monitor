// Copia texto pra area de transferencia. navigator.clipboard exige contexto seguro
// (https, que o app ja usa em producao) — sem fallback pra http puro de proposito.
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
