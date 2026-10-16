import { readdir, readFile, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

// O generator introspectado emite imports relativos sem extensão.
// Ajustar apenas o JS compilado permite execução ESM no Node, preservando schema e fontes geradas.
async function ajustarDiretorio(diretorio) {
  for (const entrada of await readdir(diretorio, { withFileTypes: true })) {
    const caminho = join(diretorio, entrada.name);
    if (entrada.isDirectory()) {
      await ajustarDiretorio(caminho);
    } else if (extname(caminho) === ".js") {
      const original = await readFile(caminho, "utf8");
      const ajustado = original.replace(/(from\s+|import\s+)(["'])(\.[^"']+)\2/g,
        (trecho, prefixo, aspas, destino) => extname(destino) ? trecho : `${prefixo}${aspas}${destino}.js${aspas}`);
      if (ajustado !== original) await writeFile(caminho, ajustado);
    }
  }
}

await ajustarDiretorio(fileURLToPath(new URL("../dist/generated/prisma", import.meta.url)));
