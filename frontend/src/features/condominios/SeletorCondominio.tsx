import { useEffect, useState } from "react";
import { listarCondominios } from "./condominio.api";
import type { Condominio } from "./condominio.types";
import type { ListaPaginada } from "../../lib/api";
import { Aviso, Campo } from "../../components/ui/Campo";
export function SeletorCondominio({ selecionado, selecionar, erro, idDesabilitado, versao = 0 }: {
  selecionado: Condominio | null; selecionar: (condominio: Condominio) => void; erro?: string;
  idDesabilitado?: string; versao?: number;
}) {
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState("");
  const [pagina, setPagina] = useState(1);
  const [tentativa, setTentativa] = useState(0);
  const [resultado, setResultado] = useState<ListaPaginada<Condominio> | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [falha, setFalha] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => { setFiltro(busca.trim()); setPagina(1); }, 300);
    return () => clearTimeout(timer);
  }, [busca]);
  useEffect(() => {
    const abort = new AbortController();
    setCarregando(true); setFalha(false); setResultado(null);
    void listarCondominios(filtro, pagina, abort.signal).then(dados => {
      if (!abort.signal.aborted) setResultado(dados);
    }).catch(() => { if (!abort.signal.aborted) setFalha(true); })
      .finally(() => { if (!abort.signal.aborted) setCarregando(false); });
    return () => abort.abort();
  }, [filtro, pagina, tentativa, versao]);
  return <div className="seletor">
    <Campo id="busca-condominio" label="Buscar condomínio" type="search" maxLength={160} value={busca} onChange={e => setBusca(e.target.value)} placeholder="Nome do residencial" />
    {selecionado && <p className="selecionado">Selecionado: <strong>{selecionado.nome_residencial}</strong></p>}
    <div role="group" aria-label="Condomínios disponíveis" aria-busy={carregando}>
      {carregando && <p role="status">Buscando condomínios…</p>}
      {falha && <Aviso erro>Não foi possível buscar condomínios. <button type="button" className="botao-texto" onClick={() => setTentativa(t => t + 1)}>Tentar novamente</button></Aviso>}
      {resultado?.dados.length === 0 && <p role="status">Nenhum condomínio encontrado. Tente outro nome.</p>}
      {resultado?.dados.map(condominio => <label className="opcao-condominio" key={condominio.id_condominio}>
        <input type="radio" name="id_condominio" value={condominio.id_condominio} disabled={condominio.id_condominio === idDesabilitado} checked={selecionado?.id_condominio === condominio.id_condominio} onChange={() => selecionar(condominio)} aria-describedby={erro ? "condominio-erro" : undefined} />
        <span><strong>{condominio.nome_residencial}</strong><small>{condominio.endereco}</small>{condominio.id_condominio === idDesabilitado && <small>Seu condomínio atual</small>}</span>
      </label>)}
    </div>
    {erro && <p role="alert" className="erro-campo" id="condominio-erro">{erro}</p>}
    {resultado && resultado.paginacao.total_paginas > 1 && <div className="paginacao" aria-label="Paginação dos condomínios">
      <button type="button" className="botao-secundario" disabled={carregando || pagina === 1} onClick={() => setPagina(p => p - 1)}>Anterior</button>
      <span>Página {pagina} de {resultado.paginacao.total_paginas}</span>
      <button type="button" className="botao-secundario" disabled={carregando || pagina >= resultado.paginacao.total_paginas} onClick={() => setPagina(p => p + 1)}>Próxima</button>
    </div>}
  </div>;
}
