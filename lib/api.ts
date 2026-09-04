"use client";
export type ApiError = Error & { status?: number; fields?: Record<string, string[]> };
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  if (response.status === 204) return undefined as T;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) { const error = new Error(payload.error ?? "Não foi possível concluir esta ação.") as ApiError; error.status = response.status; error.fields = payload.details; throw error; }
  return payload;
}
export const formatPrice = (value: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
