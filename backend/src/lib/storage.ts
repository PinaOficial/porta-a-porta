import { ErroDominio } from "./erro-dominio.js";
import { supabaseAdmin } from "./supabase.js";

const bucketImagens = "product-images";
export const PRODUCT_IMAGE_SIGNED_URL_TTL_SECONDS = 600;

export async function assinarImagensProdutos(storagePaths: string[]): Promise<Map<string, string>> {
  const urls = new Map<string, string>();
  const paths = [...new Set(storagePaths)];
  if (paths.length === 0) return urls;

  // O SDK retorna falhas operacionais em error; exceções inesperadas devem propagar.
  const bucket = await supabaseAdmin.storage.getBucket(bucketImagens);
  if (bucket.error || !bucket.data || bucket.data.public !== false) {
    console.error({ evento: "IMAGE_SIGNING_FAILED", causa: "BUCKET_UNAVAILABLE_OR_NOT_PRIVATE" });
    return urls;
  }

  const resultado = await supabaseAdmin.storage.from(bucketImagens)
    .createSignedUrls(paths, PRODUCT_IMAGE_SIGNED_URL_TTL_SECONDS);
  if (resultado.error) {
    console.error({ evento: "IMAGE_SIGNING_FAILED", causa: "STORAGE_SIGNING_UNAVAILABLE" });
    return urls;
  }

  const solicitados = new Set(paths);
  for (const imagem of resultado.data) {
    if (imagem.path && solicitados.has(imagem.path) && !imagem.error && imagem.signedUrl) {
      urls.set(imagem.path, imagem.signedUrl);
    }
  }
  for (const path of paths) {
    if (!urls.has(path)) {
      // Inclui objeto ausente, erro individual ou item omitido pelo Storage, sem reparar dados em GET.
      console.error({ evento: "IMAGE_SIGNING_FAILED", storage_path: path, causa: "IMAGE_URL_UNAVAILABLE" });
    }
  }
  return urls;
}

export async function enviarImagemProduto(storagePath: string, buffer: Buffer, mimetype: string): Promise<void> {
  try {
    // Falhar também se a configuração tornar o bucket público por engano.
    const bucket = await supabaseAdmin.storage.getBucket(bucketImagens);
    if (bucket.error || !bucket.data || bucket.data.public !== false) throw new Error("BUCKET_NOT_PRIVATE");
    const resultado = await supabaseAdmin.storage.from(bucketImagens).upload(storagePath, buffer, {
      contentType: mimetype, upsert: false,
    });
    if (resultado.error || !resultado.data) throw new Error("STORAGE_UPLOAD_FAILED");
  } catch {
    throw new ErroDominio("IMAGE_UPLOAD_FAILED", 500, "Não foi possível enviar a imagem. Verifique a configuração do bucket privado product-images.");
  }
}

function removerObjetoImagem(storagePath: string) {
  return supabaseAdmin.storage.from(bucketImagens).remove([storagePath]);
}

export async function removerImagemProduto(storagePath: string): Promise<void> {
  try {
    const bucket = await supabaseAdmin.storage.getBucket(bucketImagens);
    if (bucket.error || !bucket.data || bucket.data.public !== false) throw new Error("BUCKET_NOT_PRIVATE");
    const resultado = await removerObjetoImagem(storagePath);
    // remove pode retornar [] sem erro se o objeto já não existir.
    // Apenas NoSuchKey explícito é ausência; um 404 de bucket/tenant não é sucesso.
    if (resultado.error?.status === 404 && resultado.error.statusCode === "NoSuchKey") return;
    if (resultado.error || !resultado.data) throw new Error("STORAGE_DELETE_FAILED");
  } catch {
    throw new ErroDominio("IMAGE_DELETE_FAILED", 500, "Não foi possível excluir a imagem.");
  }
}

export async function removerImagemCompensatoria(storagePath: string): Promise<void> {
  const resultado = await removerObjetoImagem(storagePath);
  if (resultado.error) throw new ErroDominio("IMAGE_CLEANUP_FAILED", 500, "Falha na remoção compensatória da imagem.");
}
