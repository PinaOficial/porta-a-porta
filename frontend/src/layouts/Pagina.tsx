import { useState, type ReactNode } from "react";
import { useAuth } from "../features/auth/AuthProvider";
export function Marca() {
  return <div className="marca"><span className="marca-simbolo" aria-hidden="true">p<span>p</span></span><span>porta a porta<small>O seu condomínio mais perto.</small></span></div>;
}
export function Sair() {
  const { logout } = useAuth();
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState(false);
  return <div className="sair"><button className="botao-secundario" disabled={enviando} onClick={async () => {
    setEnviando(true); setErro(false);
    try { await logout(); } catch { setErro(true); } finally { setEnviando(false); }
  }}>{enviando ? "Saindo…" : "Sair da conta"}</button>{erro && <p role="alert">Não foi possível sair. Tente novamente.</p>}</div>;
}
export function Pagina({ children, ampla = false }: { children: ReactNode; ampla?: boolean }) {
  return <div className="pagina"><a className="pular" href="#conteudo">Pular para o conteúdo</a><header className="cabecalho"><Marca /></header><main id="conteudo" className={ampla ? "conteudo amplo" : "conteudo"} tabIndex={-1}>{children}</main><footer>Feito para aproximar vizinhos.</footer></div>;
}
export function Carregamento() {
  return <Pagina><section className="card central" role="status"><span className="carregador" aria-hidden="true" /><h1>Preparando seu acesso</h1><p>Aguarde enquanto carregamos sua conta.</p></section></Pagina>;
}
