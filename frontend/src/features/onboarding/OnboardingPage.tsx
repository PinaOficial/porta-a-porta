import { useRef, useState, type FormEvent } from "react";
import { Pagina, Sair } from "../../layouts/Pagina";
import { Campo, Aviso } from "../../components/ui/Campo";
import { SeletorCondominio } from "../condominios/SeletorCondominio";
import type { Condominio } from "../condominios/condominio.types";
import { onboardingSchema } from "./onboarding.schema";
import { realizarOnboarding } from "./onboarding.api";
import { useEstadoUsuario } from "../perfil/EstadoUsuarioProvider";
import { ApiError } from "../../lib/api";
const mensagens: Record<string, string> = {
  CPF_ALREADY_REGISTERED: "Este CPF já está cadastrado. Entre com a conta existente ou procure a administração.",
  EMAIL_ALREADY_REGISTERED: "Este e-mail já está vinculado a um cadastro. Procure a administração.",
  CONDOMINIO_NOT_FOUND: "Este condomínio não está mais disponível. Escolha outro na busca.",
  AUTH_EMAIL_REQUIRED: "Sua sessão não possui e-mail válido. Saia e entre novamente.",
  SUPER_ADMIN_CANNOT_ONBOARD: "Esta conta é de administração global e não utiliza cadastro residencial.",
  ONBOARDING_ALREADY_COMPLETED: "Seu cadastro já foi concluído. Atualizando seu acesso…",
};
export function OnboardingPage() {
  const { recarregarEstado } = useEstadoUsuario();
  const [campos, setCampos] = useState({ nome_completo: "", cpf: "", data_nascimento: "", moradia: "" });
  const [condominio, setCondominio] = useState<Condominio | null>(null);
  const [erros, setErros] = useState<Record<string, string>>({});
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);
  const bloqueado = useRef(false);
  async function enviar(event: FormEvent) {
    event.preventDefault();
    if (bloqueado.current) return;
    setErros({}); setErro("");
    const validacao = onboardingSchema.safeParse({ ...campos, id_condominio: condominio?.id_condominio ?? "" });
    if (!validacao.success) {
      setErros(Object.fromEntries(validacao.error.issues.map(issue => [String(issue.path[0]), issue.message]))); return;
    }
    bloqueado.current = true; setEnviando(true);
    try { await realizarOnboarding(validacao.data); await recarregarEstado(); }
    catch (error) {
      if (error instanceof ApiError) {
        setErro(mensagens[error.codigo] ?? "Não foi possível concluir o cadastro. Confira os dados e tente novamente.");
        if (error.codigo === "VALIDATION_ERROR") {
          setErros(Object.fromEntries(Object.entries(error.detalhes?.fieldErrors ?? {}).map(([campo, valores]) => [campo, valores.join(" ")])));
        }
        if (error.codigo === "CONDOMINIO_NOT_FOUND") setCondominio(null);
        if (["ONBOARDING_ALREADY_COMPLETED", "SUPER_ADMIN_CANNOT_ONBOARD"].includes(error.codigo)) await recarregarEstado();
      } else setErro("Não foi possível conectar. Seus dados foram mantidos; tente novamente.");
    } finally { bloqueado.current = false; setEnviando(false); }
  }
  return <Pagina ampla><section className="card onboarding"><p className="sobretitulo">VAMOS NOS CONHECER</p><h1>Encontre sua vizinhança</h1><p>Complete seu cadastro e solicite acesso ao condomínio onde você mora. A administração vai conferir sua solicitação.</p>
    <form onSubmit={enviar} noValidate aria-busy={enviando}><fieldset disabled={enviando}>
      <Campo id="nome_completo" label="Nome completo" autoComplete="name" required maxLength={160} value={campos.nome_completo} erro={erros.nome_completo} onChange={e => setCampos({ ...campos, nome_completo: e.target.value })} />
      <div className="duas-colunas"><Campo id="cpf" label="CPF" inputMode="numeric" required value={campos.cpf} erro={erros.cpf} onChange={e => setCampos({ ...campos, cpf: e.target.value })} />
      <Campo id="data_nascimento" label="Data de nascimento" type="date" autoComplete="bday" required value={campos.data_nascimento} erro={erros.data_nascimento} onChange={e => setCampos({ ...campos, data_nascimento: e.target.value })} /></div>
      <SeletorCondominio selecionado={condominio} selecionar={setCondominio} erro={erros.id_condominio} />
      <Campo id="moradia" label="Sua moradia" placeholder="Ex.: Bloco B, apartamento 302" autoComplete="address-line2" required maxLength={80} value={campos.moradia} erro={erros.moradia} onChange={e => setCampos({ ...campos, moradia: e.target.value })} />
      {erro && <Aviso erro>{erro}</Aviso>}
      <button className="botao-principal largura" type="submit" disabled={!condominio}>{enviando ? "Enviando solicitação…" : "Solicitar acesso ao condomínio"}</button>
    </fieldset></form><Sair /></section></Pagina>;
}
