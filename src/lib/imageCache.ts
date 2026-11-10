// Cache de imagens em disco (capas). A primeira vez mostra a imagem da rede e a guarda; nas próximas vem do disco.
import { engine } from "./engine";
import { fileUrl, isTauri } from "./native";
import { getSetting } from "../store/settings";

const local = new Map<string, string>(); // URL remota → endereço do arquivo em disco
const pending = new Set<string>();
const failed = new Set<string>();

/** Endereço a usar agora: o do disco se já estiver guardado, senão o original. */
export function cachedSrc(url: string): string { return local.get(url) ?? url; }

/** Pede ao backend para guardar a imagem; vale a partir da próxima vez que ela for desenhada. */
export function warmImage(url: string) {
  if (!isTauri || !/^https?:\/\//i.test(url) || local.has(url) || pending.has(url) || failed.has(url)) return;
  pending.add(url);
  const limit = Number(getSetting("maxImageCache") ?? 1024);
  engine.imageFetch(url, Number.isFinite(limit) ? limit : 1024)
    .then((path) => { if (path) local.set(url, fileUrl(path)); else failed.add(url); })
    .catch(() => failed.add(url))
    .finally(() => pending.delete(url));
}

export function forgetImages() { local.clear(); failed.clear(); }
