import { Component, useState, type ReactNode } from "react";
import { Check, Copy, RotateCcw, Share2, TriangleAlert } from "lucide-react";
import { copyText } from "../lib/util";
import { Btn } from "./ui";

/** Tela de relatório de erro (equivalente à CrashActivity do MetroFuse). */
export function CrashScreen({ log, onClose }: { log: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = () => { copyText(log); setCopied(true); setTimeout(() => setCopied(false), 2200); };
  return (
    <div role="alertdialog" aria-label="Relatório de erro" className="fixed inset-0 z-[100] bg-bg text-t1 flex flex-col items-center px-8 py-12 overflow-y-auto" data-theme="dark">
      <div className="size-16 rounded-full bg-danger/15 text-danger grid place-items-center mb-5"><TriangleAlert className="size-8" /></div>
      <h1 className="text-[1.8rem] font-bold tracking-tight">O MetroMusic encontrou um erro</h1>
      <p className="text-t2 max-w-lg text-center mt-2 mb-6">Algo inesperado aconteceu. Compartilhe o relatório abaixo para ajudar a corrigir o problema.</p>
      <pre className="w-full max-w-3xl flex-1 min-h-40 max-h-[48vh] overflow-auto rounded-2xl bg-s1 p-5 font-mono text-[0.8rem] leading-relaxed text-t2 whitespace-pre-wrap select-text">{log}</pre>
      <div className="flex gap-2.5 mt-6">
        <Btn variant="primary" icon={copied ? <Check /> : <Share2 />} onClick={copy}>{copied ? "Relatório copiado" : "Compartilhar relatório"}</Btn>
        <Btn icon={<Copy />} onClick={copy}>Copiar</Btn>
        <Btn variant="ghost" icon={<RotateCcw />} onClick={onClose}>Fechar e continuar</Btn>
      </div>
    </div>
  );
}

/** Captura erros de renderização e mostra o relatório em vez de uma tela em branco. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { log: string | null }> {
  state = { log: null as string | null };
  static getDerivedStateFromError(e: Error) { return { log: `MetroMusic 0.1.0\n\n${e.name}: ${e.message}\n${e.stack ?? ""}` }; }
  render() { return this.state.log ? <CrashScreen log={this.state.log} onClose={() => this.setState({ log: null })} /> : this.props.children; }
}
