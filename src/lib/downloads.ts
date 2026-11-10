// Downloads reais: baixa a faixa inteira para a pasta escolhida, com tags, capa e letra.
import { engine } from "./engine";
import { getTrack } from "./catalog";
import { isTauri, onEvent } from "./native";
import { getSetting } from "../store/settings";
import { useLib } from "../store/library";
import { toast } from "../store/ui";

const PARALLEL = 2;
const queue: string[] = [];
let running = 0, total = 0, failed = 0, listening = false;

const folder = () => String(getSetting("downloadFolder") ?? "").trim();

async function listen() {
  if (listening) return;
  listening = true;
  // progresso de cada faixa: o backend usa a mesma chave `provedor:id` do app
  await onEvent<{ key: string; progress: number }>("download:progress", ({ key, progress }) => {
    if (progress < 1 && key in useLib.getState().downloads) useLib.getState().setDownload(key, Math.max(0.001, progress));
  });
}

async function worker() {
  while (queue.length && running < PARALLEL) {
    const id = queue.shift()!;
    running++;
    (async () => {
      const t = getTrack(id);
      try {
        if (!t?.ext) throw new Error("só músicas reais podem ser baixadas");
        if (t.ext.provider === "local") throw new Error("essa música já está no computador");
        const r = await engine.download(t.ext, folder(), getSetting("writeTags") !== false, getSetting("embedLyrics") !== false);
        if (!r) throw new Error("sem resposta do app");
        useLib.getState().setDownload(id, 1, r.path);
        if (r.tagWarning) console.warn("download sem tags:", r.tagWarning);
      } catch (e) {
        failed++;
        useLib.setState((s) => { const d = { ...s.downloads }; delete d[id]; return { downloads: d }; });
        toast(`Não consegui baixar${t ? ` “${t.title}”` : ""}: ${String(e).replace(/^Error: /, "")}`);
      } finally {
        running--;
        if (!queue.length && !running) {
          const ok = total - failed;
          if (ok > 0) toast(ok === 1 ? "Download concluído" : `${ok} downloads concluídos`);
          total = 0; failed = 0;
        } else void worker();
      }
    })();
  }
}

export async function downloadTracks(ids: string[]) {
  if (!isTauri) return;
  await listen();
  for (const id of ids) if (!queue.includes(id)) { queue.push(id); total++; }
  void worker();
}

/** Apaga arquivos baixados (só áudio dentro da pasta de downloads; o backend confere). */
export function deleteFiles(paths: string[]) {
  engine.downloadDelete(paths, folder())?.catch((e) => toast(`Não consegui apagar os arquivos: ${e}`));
}

/** "Apagar todos os downloads": os arquivos e a lista. */
export function deleteAllDownloads() {
  const paths = Object.values(useLib.getState().downloadPaths);
  useLib.getState().clear("downloads");
  if (paths.length) deleteFiles(paths);
}

/** Ao abrir: some da lista o que foi apagado por fora e o que ficou pela metade. */
export async function verifyDownloads() {
  if (!isTauri) return;
  const L = useLib.getState();
  const half = Object.entries(L.downloads).filter(([k, v]) => v < 1 && !(k in L.downloadPaths)).map(([k]) => k);
  const paths = Object.entries(L.downloadPaths);
  const missing = new Set((await engine.downloadMissing(paths.map(([, p]) => p))) ?? []);
  const gone = paths.filter(([, p]) => missing.has(p)).map(([k]) => k);
  if (!half.length && !gone.length) return;
  useLib.setState((s) => {
    const d = { ...s.downloads }, p = { ...s.downloadPaths };
    [...half, ...gone].forEach((k) => { delete d[k]; delete p[k]; });
    return { downloads: d, downloadPaths: p };
  });
}
