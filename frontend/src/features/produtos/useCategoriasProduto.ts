import { useCallback, useEffect, useState } from "react";
import { ApiError } from "../../lib/api";
import { useEstadoUsuario } from "../perfil/EstadoUsuarioProvider";
import { listarCategorias } from "./produto.api";
import type { Categoria } from "./produto.types";
export function useCategoriasProduto() {
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(false);
  const [tentativa, setTentativa] = useState(0);
  const { recarregarEstado } = useEstadoUsuario();
  const atualizar = useCallback(() => setTentativa(atual => atual + 1), []);
  useEffect(() => {
    const abort = new AbortController();
    setCarregando(true); setErro(false);
    void listarCategorias(abort.signal).then(resposta => {
      if (!abort.signal.aborted) setCategorias(resposta.dados);
    }).catch(erro => {
      if (!abort.signal.aborted) {
        setErro(true);
        if (erro instanceof ApiError && ["MEMBERSHIP_REQUIRED", "FORBIDDEN_CROSS_TENANT"].includes(erro.codigo)) void recarregarEstado();
      }
    }).finally(() => { if (!abort.signal.aborted) setCarregando(false); });
    return () => abort.abort();
  }, [tentativa, recarregarEstado]);
  return { categorias, carregando, erro, atualizar };
}
