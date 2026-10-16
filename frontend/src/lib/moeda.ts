// Valores permanecem decimais. O cálculo aqui serve somente ao resumo visual.
export function formatarReais(valor: string) {
  if (!/^\d+(?:\.\d{1,2})?$/.test(valor)) return "—";
  const [inteiro, fracao = ""] = valor.split(".");
  return `R$\u00a0${new Intl.NumberFormat("pt-BR").format(BigInt(inteiro))},${fracao.padEnd(2, "0")}`;
}
export function calcularTotalEstimado(preco: string, quantidade: number) {
  if (!Number.isSafeInteger(quantidade) || quantidade < 1 || !/^\d+(?:\.\d{1,2})?$/.test(preco)) return null;
  const [inteiro, fracao = ""] = preco.split(".");
  const centavos = (BigInt(inteiro) * 100n + BigInt(fracao.padEnd(2, "0"))) * BigInt(quantidade);
  return `${centavos / 100n}.${String(centavos % 100n).padStart(2, "0")}`;
}
