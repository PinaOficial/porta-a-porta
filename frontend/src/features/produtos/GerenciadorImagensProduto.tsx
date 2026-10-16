import { useEffect, useRef, useState, type FormEvent } from "react";
import { Aviso } from "../../components/ui/Campo";
import { arquivoImagemProdutoSchema } from "./produto.schema";
import { enviarImagemProduto, excluirImagemProduto } from "./produto.api";
import { mensagemErroProduto } from "./produto.erros";
import { ImagemProduto } from "./ImagemProduto";
import type { ImagemProduto as Imagem } from "./produto.types";

export function GerenciadorImagensProduto({ id, nome, imagens, bloqueado, atualizar, aoErro, aoOcupar }: {
  id: string; nome: string; imagens: Imagem[]; bloqueado: boolean;
  atualizar: () => Promise<void>; aoErro: (erro: unknown) => Promise<void>; aoOcupar: (ocupado: boolean) => void;
}) {
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [erro, setErro] = useState("");
  const [sucesso, setSucesso] = useState("");
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [erroExclusao, setErroExclusao] = useState<{ id: string; mensagem: string } | null>(null);
  const entrada = useRef<HTMLInputElement>(null);
  const trava = useRef(false);
  useEffect(() => {
    if (!arquivo) { setPreview(""); return; }
    const url = URL.createObjectURL(arquivo); setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [arquivo]);
  function escolher(novo?: File) {
    setErro(""); setSucesso("");
    if (!novo) { setArquivo(null); return; }
    const validacao = arquivoImagemProdutoSchema.safeParse(novo);
    if (!validacao.success) { setArquivo(null); setErro(validacao.error.issues[0]?.message ?? "Imagem inválida."); return; }
    setArquivo(novo);
  }
  async function enviar(event: FormEvent) {
    event.preventDefault();
    if (trava.current || bloqueado || !arquivo) return;
    trava.current = true; setOcupado("upload"); aoOcupar(true); setErro(""); setSucesso("");
    try {
      await enviarImagemProduto(id, arquivo);
      setSucesso(`Imagem ${arquivo.name} adicionada ao anúncio.`);
      setArquivo(null); if (entrada.current) entrada.current.value = "";
    } catch (erro) { setErro(mensagemErroProduto(erro)); await aoErro(erro); }
    finally { await atualizar(); trava.current = false; setOcupado(null); aoOcupar(false); }
  }
  async function excluir(imagem: Imagem, indice: number) {
    if (trava.current || bloqueado || !window.confirm(`Excluir a imagem ${indice + 1} deste anúncio?`)) return;
    trava.current = true; setOcupado(imagem.id_imagem); aoOcupar(true); setErroExclusao(null); setSucesso("");
    try { await excluirImagemProduto(id, imagem.id_imagem); setSucesso("Imagem excluída do anúncio."); }
    catch (erro) { setErroExclusao({ id: imagem.id_imagem, mensagem: mensagemErroProduto(erro) }); await aoErro(erro); }
    finally { await atualizar(); trava.current = false; setOcupado(null); aoOcupar(false); }
  }
  const ordenadas = [...imagens].sort((a, b) => a.ordem - b.ordem);
  return <section className="card gerenciador-imagens" aria-labelledby="titulo-imagens"><div className="linha"><h2 id="titulo-imagens">Imagens do anúncio</h2><button className="botao-texto" disabled={bloqueado || Boolean(ocupado)} onClick={() => void atualizar()}>Atualizar imagens</button></div>
    {ordenadas.length === 0 ? <div className="sem-imagens"><ImagemProduto nome={nome} /><p>Seu anúncio ainda não tem imagens. Adicione a primeira abaixo.</p></div> : <div className="grade-imagens">{ordenadas.map((imagem, indice) => <div className="imagem-gestao" key={imagem.id_imagem}><ImagemProduto url={imagem.url} nome={`${nome}, imagem ${indice + 1}`} /><button className="botao-secundario" disabled={bloqueado || Boolean(ocupado)} onClick={() => void excluir(imagem, indice)}>{ocupado === imagem.id_imagem ? "Excluindo imagem…" : erroExclusao?.id === imagem.id_imagem ? `Tentar excluir imagem ${indice + 1} novamente` : `Excluir imagem ${indice + 1}`}</button>{erroExclusao?.id === imagem.id_imagem && <Aviso erro>{erroExclusao.mensagem}</Aviso>}</div>)}</div>}
    {erroExclusao && !ordenadas.some(imagem => imagem.id_imagem === erroExclusao.id) && <Aviso>{erroExclusao.mensagem}</Aviso>}
    <form onSubmit={enviar} aria-busy={ocupado === "upload"}><fieldset disabled={bloqueado || Boolean(ocupado)}><div className="campo"><label htmlFor="imagem-produto">Adicionar uma imagem</label><input id="imagem-produto" type="file" ref={entrada} accept="image/jpeg,image/png,image/webp" aria-describedby="orientacao-imagem" onChange={e => escolher(e.target.files?.[0])} /><p id="orientacao-imagem" className="ajuda">JPEG, PNG ou WEBP, até 5 MiB. Envie uma foto de cada vez; depois você pode adicionar outra.</p></div>
      {arquivo && <div className="preview-imagem"><p>Prévia local: {arquivo.name}</p>{preview && <img src={preview} alt={`Prévia de ${arquivo.name}`} />}<button type="button" className="botao-texto" onClick={() => { setArquivo(null); if (entrada.current) entrada.current.value = ""; }}>Remover seleção</button></div>}
      <button type="submit" className="botao-principal" disabled={!arquivo}>{ocupado === "upload" ? `Enviando ${arquivo?.name ?? "imagem"}…` : "Enviar imagem"}</button>
    </fieldset></form>{erro && <Aviso erro>{erro}</Aviso>}{sucesso && <Aviso>{sucesso}</Aviso>}
  </section>;
}
