import { useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "./AuthProvider";
import { cadastroSchema, loginSchema } from "./auth.schema";
import { mensagemErroAuth } from "./auth.api";
import { Campo, Aviso } from "../../components/ui/Campo";
import { Pagina } from "../../layouts/Pagina";

export function LoginPage({ cadastro = false }: { cadastro?: boolean }) {
  const auth = useAuth();
  const navigate = useNavigate();
  const [campos, setCampos] = useState({ email: "", senha: "", confirmacao: "" });
  const [erros, setErros] = useState<Record<string, string>>({});
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);
  const bloqueado = useRef(false);
  async function enviar(event: FormEvent) {
    event.preventDefault();
    if (bloqueado.current) return;
    const validacao = (cadastro ? cadastroSchema : loginSchema).safeParse(campos);
    setErros({}); setErro("");
    if (!validacao.success) {
      setErros(Object.fromEntries(validacao.error.issues.map(issue => [String(issue.path[0]), issue.message]))); return;
    }
    bloqueado.current = true; setEnviando(true);
    try {
      if (cadastro) {
        const comSessao = await auth.cadastro(validacao.data.email, validacao.data.senha);
        if (!comSessao) navigate("/confirmar-email", { replace: true });
      } else await auth.login(validacao.data.email, validacao.data.senha);
    } catch (error) { setErro(mensagemErroAuth(error)); }
    finally { bloqueado.current = false; setEnviando(false); }
  }
  return <Pagina><section className="card">
    <p className="sobretitulo">BOAS-VINDAS À VIZINHANÇA</p>
    <h1>{cadastro ? "Crie sua conta" : "Bom ter você por aqui"}</h1>
    <p>{cadastro ? "Seu primeiro passo para se conectar ao condomínio." : "Entre para se conectar com quem mora perto."}</p>
    <form onSubmit={enviar} noValidate aria-busy={enviando}>
      <fieldset disabled={enviando}>
        <Campo id="email" label="E-mail" type="email" autoComplete="email" required value={campos.email} erro={erros.email} onChange={e => setCampos({ ...campos, email: e.target.value })} />
        <Campo id="senha" label="Senha" type="password" autoComplete={cadastro ? "new-password" : "current-password"} required value={campos.senha} erro={erros.senha} onChange={e => setCampos({ ...campos, senha: e.target.value })} />
        {cadastro && <Campo id="confirmacao" label="Confirmar senha" type="password" autoComplete="new-password" required value={campos.confirmacao} erro={erros.confirmacao} onChange={e => setCampos({ ...campos, confirmacao: e.target.value })} />}
        {erro && <Aviso erro>{erro}</Aviso>}
        <button className="botao-principal largura" type="submit">{enviando ? "Aguarde…" : cadastro ? "Criar conta" : "Entrar"}</button>
      </fieldset>
    </form>
    <p className="rodape-card">{cadastro ? "Já tem uma conta? " : "Ainda não tem uma conta? "}<Link to={cadastro ? "/login" : "/cadastro"}>{cadastro ? "Entrar" : "Cadastre-se"}</Link></p>
  </section></Pagina>;
}
export function ConfirmarEmailPage() {
  return <Pagina><section className="card"><p className="sobretitulo">CONFIRA SUA CAIXA DE ENTRADA</p><h1>Confirme seu e-mail</h1><p>Recebemos seu cadastro. Abra o link enviado ao seu e-mail para confirmar a conta. Confira também a pasta de spam.</p><Link className="botao-principal" to="/login">Voltar para entrar</Link></section></Pagina>;
}
