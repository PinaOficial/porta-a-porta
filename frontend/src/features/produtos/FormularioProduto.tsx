import { useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "../../lib/api";
import { Aviso, Campo } from "../../components/ui/Campo";
import { criarProduto, editarProduto } from "./produto.api";
import { diferencaProduto, formularioProdutoSchema } from "./produto.schema";
import { mensagemErroProduto } from "./produto.erros";
import type { Categoria, DadosProduto, ProdutoDetalhe } from "./produto.types";

export function FormularioProduto({ produto, categorias, carregandoCategorias, erroCategorias, atualizarCategorias, bloqueado, voltar, aoSalvar, aoErro, aoOcupar }: {
  produto?: ProdutoDetalhe; categorias: Categoria[]; carregandoCategorias: boolean; erroCategorias: boolean;
  atualizarCategorias: () => void; bloqueado: boolean; voltar: string;
  aoSalvar: (id: string) => Promise<void>; aoErro: (erro: unknown) => Promise<void>; aoOcupar: (ocupado: boolean) => void;
}) {
  const [inicial] = useState(() => produto ? { id_categoria: produto.categoria.id_categoria, nome_produto: produto.nome_produto, descricao: produto.descricao, preco: produto.preco, estoque: produto.estoque } : null);
  const [campos, setCampos] = useState(() => ({ id_categoria: inicial?.id_categoria ?? "", nome_produto: inicial?.nome_produto ?? "", descricao: inicial?.descricao ?? "", preco: inicial?.preco ?? "", estoque: String(inicial?.estoque ?? 0) }));
  const [erros, setErros] = useState<Record<string, string>>({});
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);
  const trava = useRef(false);
  const normalizado = formularioProdutoSchema.safeParse(campos);
  const diff = inicial && normalizado.success ? diferencaProduto(inicial, normalizado.data) : null;
  const semMudanca = Boolean(diff && Object.keys(diff).length === 0);
  const categoriaIndisponivel = !categorias.some(item => item.id_categoria === campos.id_categoria);
  const criacaoIndisponivel = !produto && (carregandoCategorias || erroCategorias || categorias.length === 0);
  async function enviar(event: FormEvent) {
    event.preventDefault();
    if (trava.current || bloqueado || criacaoIndisponivel) return;
    setErros({}); setErro("");
    const resultado = formularioProdutoSchema.safeParse(campos);
    if (!resultado.success) { setErros(Object.fromEntries(resultado.error.issues.map(issue => [String(issue.path[0]), issue.message]))); return; }
    const dados: DadosProduto = resultado.data;
    if ((!inicial || dados.id_categoria !== inicial.id_categoria) && !categorias.some(item => item.id_categoria === dados.id_categoria)) { setErros({ id_categoria: "Escolha uma categoria ativa disponível." }); return; }
    const alteracoes = inicial ? diferencaProduto(inicial, dados) : null;
    if (alteracoes && Object.keys(alteracoes).length === 0) { setErro("Nenhuma alteração para salvar."); return; }
    trava.current = true; setEnviando(true); aoOcupar(true);
    try {
      if (produto && alteracoes) { await editarProduto(produto.id_produto, alteracoes); await aoSalvar(produto.id_produto); }
      else { const resposta = await criarProduto(dados); await aoSalvar(resposta.dados.id_produto); }
    } catch (erro) {
      setErro(mensagemErroProduto(erro));
      if (erro instanceof ApiError && erro.codigo === "VALIDATION_ERROR") setErros(Object.fromEntries(Object.entries(erro.detalhes?.fieldErrors ?? {}).map(([campo, valores]) => [campo, valores.join(" ")])));
      await aoErro(erro);
    } finally { trava.current = false; setEnviando(false); aoOcupar(false); }
  }
  return <section className="card editor-produto"><h2>{produto ? "Dados do anúncio" : "O que você vai oferecer?"}</h2><form onSubmit={enviar} noValidate aria-busy={enviando}><fieldset disabled={enviando || bloqueado}>
    <div className="campo"><label htmlFor="categoria-formulario">Categoria</label><select id="categoria-formulario" required disabled={carregandoCategorias || erroCategorias || categorias.length === 0} value={campos.id_categoria} aria-invalid={Boolean(erros.id_categoria)} aria-describedby={erros.id_categoria ? "categoria-formulario-erro" : undefined} onChange={e => setCampos({ ...campos, id_categoria: e.target.value })}><option value="">Selecione uma categoria</option>{campos.id_categoria && categoriaIndisponivel && <option value={campos.id_categoria} disabled>{produto?.categoria.id_categoria === campos.id_categoria ? produto.categoria.nome : "Categoria selecionada"} · indisponível/inativa</option>}{categorias.map(item => <option key={item.id_categoria} value={item.id_categoria}>{item.nome}</option>)}</select>{erros.id_categoria && <span className="erro-campo" id="categoria-formulario-erro" role="alert">{erros.id_categoria}</span>}</div>
    {carregandoCategorias && <p role="status">Carregando categorias…</p>}{erroCategorias && <Aviso erro>Não foi possível carregar categorias. <button type="button" className="botao-texto" onClick={atualizarCategorias}>Tentar categorias novamente</button></Aviso>}
    {!carregandoCategorias && !erroCategorias && categorias.length === 0 && <Aviso>{produto ? "Sem categorias ativas no momento. Você pode editar os demais campos mantendo a categoria atual." : "Não há categorias ativas para publicar um produto. Aguarde uma categoria disponível."}</Aviso>}
    {produto && !produto.categoria.ativo && <Aviso>A categoria atual está inativa. Você pode manter a categoria e editar os outros campos. Para ativar o anúncio, escolha uma categoria ativa.</Aviso>}
    <Campo id="nome_produto" label="Nome do produto" required maxLength={140} value={campos.nome_produto} erro={erros.nome_produto} onChange={e => setCampos({ ...campos, nome_produto: e.target.value })} />
    <div className="campo"><label htmlFor="descricao">Descrição</label><textarea id="descricao" required rows={5} value={campos.descricao} aria-invalid={Boolean(erros.descricao)} aria-describedby={erros.descricao ? "descricao-erro" : undefined} onChange={e => setCampos({ ...campos, descricao: e.target.value })} />{erros.descricao && <span className="erro-campo" id="descricao-erro" role="alert">{erros.descricao}</span>}</div>
    <div className="duas-colunas"><Campo id="preco" label="Preço (R$)" inputMode="decimal" required placeholder="25,90" value={campos.preco} erro={erros.preco} onChange={e => setCampos({ ...campos, preco: e.target.value })} /><Campo id="estoque" label="Estoque" type="number" inputMode="numeric" min={0} max={2147483647} step={1} required value={campos.estoque} erro={erros.estoque} onChange={e => setCampos({ ...campos, estoque: e.target.value })} /></div>
    <p className="ajuda">Informe o preço sem separador de milhar, como 25,90. Estoque zero é permitido.</p>
    {erro && <Aviso erro>{erro}</Aviso>}{semMudanca && <p className="ajuda">Nenhuma alteração para salvar.</p>}
    <div className="acoes-produto"><button type="submit" className="botao-principal" disabled={semMudanca || criacaoIndisponivel}>{enviando ? "Salvando…" : produto ? "Salvar alterações" : "Publicar produto"}</button><Link className="botao-secundario" to={voltar}>Voltar à lista</Link></div>
  </fieldset></form></section>;
}
