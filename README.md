<div align="center">

<img src="src-tauri/icons/128x128@2x.png" alt="Ícone do MetroMusic" width="160" />

# MetroMusic

### Player de música para desktop: YouTube Music, SoundCloud e Spotify num lugar só, com letras palavra a palavra, Discord e Ouvir junto.

<br/>

[![Última versão](https://img.shields.io/github/v/release/caduHD4/MetroMusic?style=for-the-badge&labelColor=0d1117&color=a78bfa)](https://github.com/caduHD4/MetroMusic/releases/latest)
[![Licença](https://img.shields.io/badge/licen%C3%A7a-GPL--3.0-blue?style=for-the-badge&labelColor=0d1117)](LICENSE)
[![Downloads](https://img.shields.io/github/downloads/caduHD4/MetroMusic/total?style=for-the-badge&labelColor=0d1117)](https://github.com/caduHD4/MetroMusic/releases)
[![Plataformas](https://img.shields.io/badge/plataformas-Linux%20%C2%B7%20Windows-4c1d95?style=for-the-badge&labelColor=0d1117)](#instalar)
[![CI](https://img.shields.io/github/actions/workflow/status/caduHD4/MetroMusic/ci.yml?branch=main&style=for-the-badge&labelColor=0d1117&label=testes)](https://github.com/caduHD4/MetroMusic/actions/workflows/ci.yml)

<br/>

[**Telas**](#telas) · [**Recursos**](#recursos) · [**Instalar**](#instalar) · [**Atualizações**](#atualiza%C3%A7%C3%B5es-autom%C3%A1ticas) · [**Serviços**](#contas-e-servi%C3%A7os) · [**Compilar**](#compilar) · [**Créditos**](#cr%C3%A9ditos)

</div>

> [!WARNING]
> O MetroMusic conecta a serviços de terceiros escolhidos por você. Disponibilidade, qualidade, catálogo, login e acesso por região podem mudar a qualquer momento e podem exigir a sua própria conta. É um projeto independente e não oficial, sem vínculo com YouTube, Google, Spotify, Discord, SoundCloud ou qualquer outro serviço citado.

---

## Telas

<div align="center">

<img src="docs/screenshots/01-inicio.png" alt="Início" width="100%" />

<sub>**Início:** o conteúdo da sua conta do YouTube Music (ou de outra fonte), com atalhos por humor.</sub>

<br/><br/>

<img src="docs/screenshots/02-tocando-agora.png" alt="Tocando agora, com letra sincronizada" width="100%" />

<sub>**Tocando agora:** letra palavra a palavra, fundo "Galáxia" que acompanha a capa e a linha da letra sob a capa.</sub>

<br/><br/>

<img src="docs/screenshots/03-biblioteca.png" alt="Biblioteca" width="49%" />
<img src="docs/screenshots/04-explorar.png" alt="Explorar" width="49%" />

<img src="docs/screenshots/06-equalizador.png" alt="Equalizador" width="49%" />
<img src="docs/screenshots/05-configuracoes.png" alt="Configurações" width="49%" />

<img src="docs/screenshots/08-boas-vindas.png" alt="Boas-vindas: conectar os serviços" width="49%" />
<img src="docs/screenshots/07-atualizacao.png" alt="Aviso de atualização com o que mudou" width="49%" />

</div>

---

## O que é o MetroMusic?

Um player de música para o desktop, feito com **Tauri (Rust)** e **React**, inspirado no [MetroFuse](https://github.com/956tris/MetroFuse) e no [Metrolist](https://github.com/MetrolistGroup/Metrolist). Ele junta várias fontes de áudio e de catálogo em uma só interface, toca com um motor próprio (equalizador, normalização, crossfade e reprodução sem pausa) e se integra ao Discord, ao Last.fm e ao Spotify.

Tudo o que precisa de conta é opcional: dá para usar só com a busca e a reprodução.

---

## Recursos

| Reprodução | Descoberta |
| --- | --- |
| Motor de áudio próprio em Rust (equalizador de 10 bandas, normalização, crossfade, gapless) | Início, Explorar e páginas de artista/álbum do YouTube Music |
| Escolha da fonte de áudio por faixa, mostrando só resultados válidos | Busca de músicas, álbuns, artistas e playlists |
| Cache de músicas e de capas em disco, com limite | Importar playlists de M3U, CSV e links do YouTube Music e do Spotify |
| Downloads com título, artista, álbum, capa e letra gravados no arquivo | Biblioteca local: varre suas pastas e acompanha mudanças |
| Timer de sono, alarmes e sono automático | Histórico de escuta e estatísticas |

| Letras | Integrações |
| --- | --- |
| Letra sincronizada palavra a palavra (BetterLyrics, LrcLib, KuGou e Spotify) | **Discord Rich Presence** sem configurar nada, com tempo e pausa |
| Romanização: japonês, coreano, chinês, cirílico, hindi e punjabi | **Ouvir junto**, compatível com as salas do MetroFuse e do Metrolist |
| Tradução por IA (OpenRouter, OpenAI, Claude, Gemini, DeepL e outros) | YouTube Music, Spotify, SoundCloud e Last.fm: curtidas e playlists sincronizadas |
| `.lrc` ao lado do arquivo ou letra gravada na tag, para a biblioteca local | Spotify Canvas sobre a capa (com a conta do Spotify) |

| Aparência | Sistema |
| --- | --- |
| Temas, paletas e fundos "Galáxia" e desfocados | Atualização automática pelo GitHub, sem instalador |
| Idiomas: português e inglês | Bandeja, atalhos globais, mídia do sistema (MPRIS), iniciar com o sistema |
| Backup e restauração das suas coisas | Proxy HTTP e SOCKS5, configurações em arquivo e segredos separados |

---

## Instalar

Baixe a versão mais recente na [página de releases](https://github.com/caduHD4/MetroMusic/releases/latest).

| Sistema | Arquivo | Observação |
| --- | --- | --- |
| **Linux** | `MetroMusic_*_amd64.AppImage` | Recomendado: é o que se **atualiza sozinho**. Dê permissão (`chmod +x`) e abra. |
| Linux (Debian/Ubuntu) | `MetroMusic_*_amd64.deb` | Instala no sistema, mas as atualizações automáticas pedem permissão de administrador, então ele não se atualiza sozinho. |
| **Windows** | `MetroMusic_*_x64-setup.exe` | O primeiro uso instala normalmente; **as atualizações seguintes são silenciosas**. |

macOS ainda não tem pacote.

### Aviso do Windows ("Fornecedor desconhecido")

Ao abrir o instalador, o Windows Defender SmartScreen pode mostrar **"O Windows protegeu o computador"** e **"Fornecedor desconhecido"**. Isso acontece porque o instalador ainda **não tem assinatura de código** (um certificado pago, que projetos novos e gratuitos costumam não ter), e não porque algo esteja errado com o arquivo. Para continuar:

1. Clique em **Mais informações**.
2. Clique em **Executar assim mesmo**.

O código é aberto e cada pacote da release é assinado com a chave do projeto (é essa assinatura que o atualizador confere). Quem preferir pode compilar a partir do código-fonte (veja [Compilar](#compilar)).

### Dependências no Linux

O AppImage já traz quase tudo. Para o áudio e a bandeja, o sistema precisa de `alsa` (ou PipeWire com `pipewire-alsa`) e do `libayatana-appindicator`.

---

## Atualizações automáticas

O MetroMusic se atualiza como o Discord: **sem assistente de instalação**.

1. Ao abrir (e a cada 6 horas), o app procura uma versão nova no GitHub.
2. Se houver, aparece um **aviso pequeno com o que mudou** e o botão **Atualizar**.
3. Ao clicar, ele baixa em segundo plano, troca os arquivos e **reinicia sozinho**.

Detalhes:

- A branch **`main` é o canal estável**: a atualização vem sempre da última release publicada.
- Cada pacote é **assinado**; o app só instala o que bate com a chave pública embutida nele.
- Dá para **pular uma versão** ou desligar o aviso em *Configurações › Atualizações*, e procurar manualmente quando quiser.

---

## Contas e serviços

Na primeira vez que você abre o app, uma tela mostra como conectar os serviços. Tudo é opcional e dá para fazer depois em *Configurações › Integrações*.

| Serviço | O que faz | Precisa de login? |
| --- | --- | --- |
| **YouTube Music** | Fonte principal de áudio. Início, playlists e curtidas da sua conta | Opcional |
| **Spotify** | Sua biblioteca e playlists, letras e Canvas | Opcional |
| **Discord** | Mostra no perfil o que você ouve, com o tempo e a pausa | **Não**: basta deixar o Discord aberto |
| SoundCloud | Fonte de áudio e curtidas | Opcional |
| Last.fm | Scrobbling e "tocando agora" | Opcional |

Sessões e chaves ficam **só no seu computador**, em um arquivo separado (permissão `0600`).

**Indisponíveis por enquanto:** TIDAL, Qobuz e Deezer (áudio protegido).

---

## Compilar

Pré-requisitos: [Node.js](https://nodejs.org) 22+, [pnpm](https://pnpm.io), [Rust](https://rustup.rs) e as [dependências do Tauri](https://v2.tauri.app/start/prerequisites/) do seu sistema. No Linux também: `libasound2-dev`, `libwebkit2gtk-4.1-dev`, `libayatana-appindicator3-dev`.

```bash
pnpm install
pnpm tauri dev      # abre o app em modo de desenvolvimento
pnpm tauri build    # gera os pacotes (precisa das chaves de assinatura para o atualizador)
```

### Testes

```bash
pnpm exec tsc --noEmit            # tipos
node --test scripts/tests/*.test.mjs   # testes da interface (lógica pura)
cd src-tauri && cargo test --lib       # testes do backend
pnpm test:net                          # Ouvir junto contra o servidor real (precisa de internet)
```

Há também testes de rede (`cargo test net_ -- --ignored`) que falam com os serviços de verdade.

### Como lançar uma versão

1. Aumente a versão em `package.json`, `src-tauri/Cargo.toml` e `src-tauri/tauri.conf.json`.
2. Descreva as mudanças em uma nova seção `## x.y.z` do [`CHANGELOG.md`](CHANGELOG.md): é o texto que aparece no aviso de atualização.
3. Faça o merge na `main` e crie a tag: `git tag vx.y.z && git push origin vx.y.z`.
4. O GitHub Actions compila, assina e publica a release com o `latest.json` que o app usa.

As chaves de assinatura (`TAURI_SIGNING_PRIVATE_KEY` e a senha) ficam nos *secrets* do repositório. **Guarde uma cópia da chave privada**: sem ela, as versões antigas não aceitam mais atualizações.

---

## Documentação

- [`docs/BACKEND.md`](docs/BACKEND.md): como o backend em Rust é organizado.
- [`docs/CONFIGURACOES-AUDITORIA.md`](docs/CONFIGURACOES-AUDITORIA.md): tudo o que cada configuração faz, como foi validado e o que ainda está "Em breve".

---

## Créditos

- [MetroFuse](https://github.com/956tris/MetroFuse), [MetroFuse+](https://github.com/caduHD4/MetroFusePlus) e [Metrolist](https://github.com/MetrolistGroup/Metrolist): a base de ideias e de integrações (letras, Ouvir junto, provedores).
- [InnerTune](https://github.com/z-huang/InnerTune) e [OuterTune](https://github.com/DD3Boh/OuterTune), de onde o Metrolist vem.
- Letras: [BetterLyrics](https://github.com/boidushya/better-lyrics), [LrcLib](https://lrclib.net), KuGou e Spotify.
- Feito com [Tauri](https://tauri.app), [React](https://react.dev), [Symphonia](https://github.com/pdeljanov/Symphonia), [lofty](https://github.com/Serial-ATA/lofty-rs) e [protobuf.js](https://github.com/protobufjs/protobuf.js).

## Licença

[GPL-3.0](LICENSE), a mesma licença do MetroFuse e do Metrolist.
