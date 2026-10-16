import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useAuth } from "../auth/AuthProvider";
import { consultarMeuUsuario } from "./perfil.api";
import { consultarSituacaoResidencial } from "../vinculos/vinculo.api";
import type { MeuUsuario } from "./perfil.types";
import type { SituacaoResidencial } from "../vinculos/vinculo.types";
import { api, ApiError } from "../../lib/api";

interface EstadoUsuario {
  meuUsuario: MeuUsuario | null; situacaoResidencial: SituacaoResidencial | null;
  carregandoEstado: boolean; erroEstado: ApiError | null;
}
const vazio: EstadoUsuario = { meuUsuario: null, situacaoResidencial: null, carregandoEstado: false, erroEstado: null };
const Contexto = createContext<(EstadoUsuario & { recarregarEstado: () => Promise<void> }) | null>(null);
export function EstadoUsuarioProvider({ children }: { children: ReactNode }) {
  const { usuario } = useAuth();
  const id = usuario?.id;
  const [registro, setRegistro] = useState<EstadoUsuario & { id?: string }>(vazio);
  const controle = useRef<AbortController | null>(null);
  const idAtual = useRef(id);
  idAtual.current = id;
  const recarregarEstado = useCallback(async () => {
    // Um consumidor desmontado pode concluir uma escrita depois da troca de conta.
    // Não cancelar nem apagar o estado da identidade que está usando a aplicação agora.
    if (idAtual.current !== id) return;
    controle.current?.abort();
    const abort = new AbortController();
    controle.current = abort;
    if (!id) { setRegistro(vazio); return; }
    setRegistro({ ...vazio, id, carregandoEstado: true });
    try {
      const [pessoa, residencia] = await Promise.all([consultarMeuUsuario(abort.signal), consultarSituacaoResidencial(abort.signal)]);
      if (!abort.signal.aborted && idAtual.current === id) {
        if (pessoa.dados.id_usuario !== id) throw new Error("Identidade inconsistente.");
        setRegistro({ id, meuUsuario: pessoa.dados, situacaoResidencial: residencia.dados, carregandoEstado: false, erroEstado: null });
      }
    } catch (erro) {
      if (!abort.signal.aborted && idAtual.current === id) setRegistro({ ...vazio, id, erroEstado: erro instanceof ApiError ? erro : new ApiError(0, "STATE_LOAD_FAILED", "Não foi possível carregar seu acesso. Verifique sua conexão e tente novamente.") });
    }
  }, [id]);
  useEffect(() => {
    const cancelar = api.observarErros((erro, autor) => {
      if (autor === idAtual.current && (erro.codigo === "ACCOUNT_SUSPENDED" || erro.codigo === "UNAUTHENTICATED")) {
        controle.current?.abort();
        setRegistro({ ...vazio, id: autor, erroEstado: erro });
      }
    });
    void recarregarEstado();
    return () => { cancelar(); controle.current?.abort(); };
  }, [recarregarEstado]);
  // Bloqueia dados anteriores já no render da troca de identidade, antes dos efeitos.
  const estado = registro.id === id ? registro : { ...vazio, carregandoEstado: Boolean(id) };
  return <Contexto.Provider value={{ ...estado, recarregarEstado }}>{children}</Contexto.Provider>;
}
export function useEstadoUsuario() {
  const contexto = useContext(Contexto);
  if (!contexto) throw new Error("EstadoUsuarioProvider ausente.");
  return contexto;
}
