import { useState } from "react";
import type { ImagemProduto as Imagem } from "./produto.types";
export function ImagemProduto({ url, nome }: { url?: string; nome: string }) {
  const [falhou, setFalhou] = useState<string>();
  return <div className="imagem-produto">{url && falhou !== url
    ? <img src={url} alt={nome} loading="lazy" onError={() => setFalhou(url)} />
    : <div className="imagem-placeholder" role="img" aria-label={`${nome}: imagem indisponível`}><span aria-hidden="true">⌂</span><span>Sem imagem disponível</span></div>}
  </div>;
}
export function GaleriaProduto({ imagens, nome }: { imagens: Imagem[]; nome: string }) {
  const [selecionada, setSelecionada] = useState(0);
  const indice = selecionada < imagens.length ? selecionada : 0;
  return <div className="galeria">
    <ImagemProduto url={imagens[indice]?.url} nome={nome} />
    {imagens.length > 1 && <div className="miniaturas" role="group" aria-label="Imagens do produto">{imagens.map((imagem, i) =>
      <button type="button" key={imagem.id_imagem} aria-label={`Ver imagem ${i + 1} de ${imagens.length}`} aria-pressed={i === indice} onClick={() => setSelecionada(i)}><ImagemProduto url={imagem.url} nome={`${nome}, imagem ${i + 1}`} /></button>
    )}</div>}
  </div>;
}
