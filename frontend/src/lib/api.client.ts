export class ApiError extends Error {
  constructor(
    public status: number,
    public codigo: string,
    public mensagem: string,
    public detalhes?: { formErrors?: string[]; fieldErrors?: Record<string, string[]> },
  ) {
    super(mensagem);
    this.name = "ApiError";
  }
}

export interface SessaoApi { access_token: string; user: { id: string } }
export interface Objeto<T> { dados: T }
export interface Paginacao { pagina: number; limite: number; total: number; total_paginas: number }
export interface ListaPaginada<T> extends Objeto<T[]> { paginacao: Paginacao }
type Opcoes = Omit<RequestInit, "body"> & { body?: BodyInit; json?: unknown };

export function criarApi(config: {
  baseUrl: string;
  obterSessao: () => Promise<SessaoApi | null>;
  renovarSessao: () => Promise<SessaoApi | null>;
  fetch?: typeof fetch;
}) {
  const ouvintes = new Set<(erro: ApiError, idUsuario: string) => void>();
  let renovacao: Promise<SessaoApi | null> | undefined;
  async function requisitar<T = void>(path: string, opcoes: Opcoes = {}): Promise<T> {
    // Paths locais impedem envio de Bearer para uma origem fornecida pelo chamador.
    if (!path.startsWith("/") || path.startsWith("//")) throw new Error("Caminho de API inválido.");
    const sessao = await config.obterSessao();
    if (!sessao) throw new ApiError(401, "UNAUTHENTICATED", "Entre novamente para continuar.");
    const { json, ...init } = opcoes;
    const headers = new Headers(init.headers);
    headers.set("Accept", "application/json");
    if (json !== undefined) headers.set("Content-Type", "application/json");
    else if (init.body instanceof FormData) headers.delete("Content-Type");
    const body = json !== undefined ? JSON.stringify(json) : init.body;
    async function enviar(token: string) {
      headers.set("Authorization", `Bearer ${token}`);
      try {
        return await (config.fetch ?? fetch)(`${config.baseUrl.replace(/\/$/, "")}${path}`, { ...init, body, headers });
      } catch (erro) {
        if (init.signal?.aborted) throw erro;
        throw new ApiError(0, "NETWORK_ERROR", "Não foi possível conectar. Verifique sua conexão e tente novamente.");
      }
    }
    let resposta = await enviar(sessao.access_token);
    async function lerErro(response: Response) {
      const payload = await response.json().catch(() => ({}));
      return new ApiError(response.status, typeof payload.erro === "string" ? payload.erro : "HTTP_ERROR",
        typeof payload.mensagem === "string" ? payload.mensagem : "Não foi possível concluir a solicitação.", payload.detalhes);
    }
    let erro = resposta.ok ? undefined : await lerErro(resposta);
    if (erro?.status === 401 && erro.codigo === "UNAUTHENTICATED") {
      renovacao ??= config.renovarSessao().catch(() => null).finally(() => { renovacao = undefined; });
      const nova = await renovacao;
      // Não repetir uma escrita em nome de outra pessoa após troca de conta.
      const atual = await config.obterSessao();
      if (nova && atual?.user.id === sessao.user.id && nova.user.id === sessao.user.id && nova.access_token !== sessao.access_token) {
        resposta = await enviar(nova.access_token);
        erro = resposta.ok ? undefined : await lerErro(resposta);
      }
    }
    if (erro) {
      ouvintes.forEach(ouvinte => ouvinte(erro!, sessao.user.id));
      throw erro;
    }
    if (resposta.status === 204) return undefined as T;
    return resposta.json() as Promise<T>;
  }
  return {
    requisitar,
    observarErros(ouvinte: (erro: ApiError, idUsuario: string) => void) {
      ouvintes.add(ouvinte);
      return () => { ouvintes.delete(ouvinte); };
    },
  };
}
