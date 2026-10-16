import assert from "node:assert/strict";
import { after, mock } from "node:test";
import { supabaseAdmin } from "../src/lib/supabase.js";

// Somente testes: nenhum objeto é enviado ao Supabase real.
export function simularStorageAssinatura() {
  const ausentes = new Set<string>();
  const assinar = mock.fn(async (paths: string[], expiresIn: number) => {
    assert.equal(expiresIn, 600);
    return { error: null, data: [...paths].reverse().map((path) => ({
      path,
      error: ausentes.has(path) ? "Object not found" : null,
      signedUrl: ausentes.has(path) ? null : `https://storage.exemplo.com/${path}?token=ficticio`,
    })) };
  });
  const getBucketOriginal = supabaseAdmin.storage.getBucket;
  const fromOriginal = supabaseAdmin.storage.from;
  Reflect.set(supabaseAdmin.storage, "getBucket", async (nome: string) => {
    assert.equal(nome, "product-images");
    return { data: { public: false }, error: null };
  });
  Reflect.set(supabaseAdmin.storage, "from", (nome: string) => {
    assert.equal(nome, "product-images");
    return { createSignedUrls: assinar };
  });
  after(() => {
    Reflect.set(supabaseAdmin.storage, "getBucket", getBucketOriginal);
    Reflect.set(supabaseAdmin.storage, "from", fromOriginal);
  });
  return { assinar, ausentes };
}
