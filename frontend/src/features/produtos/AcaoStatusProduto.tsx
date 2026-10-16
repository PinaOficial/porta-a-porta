import { useRef, useState } from "react";
import { Aviso } from "../../components/ui/Campo";
import { alterarStatusProduto } from "./produto.api";
import { mensagemErroProduto } from "./produto.erros";
export function AcaoStatusProduto({ id, ativo, bloqueado, atualizar, aoErro, aoOcupar }: {
  id: string; ativo: boolean; bloqueado?: boolean; atualizar: () => Promise<void>;
  aoErro: (erro: unknown) => Promise<void>; aoOcupar?: (ocupado: boolean) => void;
}) {
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");
  const [sucesso, setSucesso] = useState("");
  const trava = useRef(false);
  async function alterar() {
    if (trava.current || bloqueado) return;
    trava.current = true; setEnviando(true); aoOcupar?.(true); setErro(""); setSucesso("");
    try {
      await alterarStatusProduto(id, !ativo);
      setSucesso(ativo ? "Anúncio desativado." : "Anúncio ativado.");
      await atualizar();
    } catch (erro) { setErro(mensagemErroProduto(erro)); await aoErro(erro); }
    finally { trava.current = false; setEnviando(false); aoOcupar?.(false); }
  }
  return <div className="acao-status"><button className="botao-secundario" disabled={enviando || bloqueado} onClick={() => void alterar()}>{enviando ? "Atualizando status…" : ativo ? "Desativar" : "Ativar"}</button>
    {erro && <Aviso erro>{erro}</Aviso>}{sucesso && <p role="status">{sucesso}</p>}
  </div>;
}
