import { Link } from "react-router-dom";
import { useEstadoUsuario } from "../perfil/EstadoUsuarioProvider";
export function AdminPage() {
  const { meuUsuario } = useEstadoUsuario();
  return <section className="administracao"><div className="titulo-vitrine"><h1>Administração</h1><p>{meuUsuario?.super_admin ? "Gerencie vínculos de todos os condomínios. Ações globais de conta estão na lista de moradores e vínculos." : "Gerencie as solicitações e os vínculos do seu condomínio."}</p></div>
    <div className="grade-admin"><article className="card"><h2>Solicitações pendentes</h2><p>Confira os pedidos de residência e decida sobre aprovação ou rejeição.</p><Link className="botao-principal" to="/admin/vinculos/pendentes">Ver solicitações pendentes</Link></article><article className="card"><h2>Moradores e vínculos</h2><p>Consulte estados residenciais, suspenda vínculos e gerencie administradores locais.</p><Link className="botao-secundario" to="/admin/vinculos">Gerenciar vínculos</Link></article></div>
  </section>;
}
