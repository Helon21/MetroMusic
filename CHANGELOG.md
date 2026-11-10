# Changelog

Cada versão publicada no GitHub usa o texto da sua seção como "o que mudou" (é o que aparece no aviso de atualização dentro do app).

## 0.1.2

O AppImage do Linux agora usa a placa de vídeo.

### Linux
- **O AppImage é compilado no Ubuntu 24.04**, com o WebKit 2.52 embutido (antes vinha um WebKit mais antigo que, em alguns sistemas como CachyOS com placa NVIDIA, desenhava tudo pela CPU e deixava a interface lenta). Com o novo, o WebKit inicializa a GPU.
- Em *Configurações › Aparência › Desempenho visual* agora aparece **qual placa de vídeo o app está usando** (ou "desenhando por software") e se o modo leve está ligado, para conferir na hora.
- Requisito do pacote: sistemas com glibc 2.39 ou mais novo (Ubuntu 24.04+, Debian 13+, Fedora 40+, Arch e derivados). Em distribuições mais antigas, compile a partir do código.

## 0.1.1

Correção de desempenho: o app agora roda fluido em qualquer PC, inclusive sem placa de vídeo.

### Desempenho
- **Modo leve automático:** se o PC não tem GPU (desenho por software) ou o app percebe lentidão, ele desliga sozinho os desfoques gigantes, as sombras grandes, as animações decorativas e os vídeos de fundo. Quem tem GPU continua com todos os efeitos, sem mudança.
- Nova opção em *Configurações › Aparência › Desempenho visual*: Automático (padrão), Completo ou Leve.
- No modo leve, o fundo desfocado do Tocando agora vira um gradiente com a cor da capa, e a letra anima a 30 quadros por segundo.
- Em qualquer PC: as animações pausam quando a janela está escondida ou sem foco, e o desfoque da letra só vale nas linhas próximas à atual.
- Testado desenhando por software: o custo de CPU do Início caiu de 15% para 3% de um núcleo, e o do Tocando agora com desfoque em movimento, de 117% para 16%.

### Linux
- O AppImage traz o seu próprio WebKit e, em alguns sistemas (por exemplo com placa NVIDIA), ele não usa a GPU. O modo leve cobre esse caso. Quem prefere o WebKit do sistema pode usar o pacote `.deb` ou compilar a partir do código.

## 0.1.0

Primeira versão pública do MetroMusic.

### Ouvir música
- YouTube Music e SoundCloud tocam direto no app; escolha de fonte por faixa mostrando só resultados válidos.
- Qualidade do áudio configurável, equalizador de 10 bandas, normalização, crossfade e reprodução sem pausa entre faixas.
- Timer de sono, alarmes e sono automático.

### Letras
- Letras sincronizadas palavra a palavra (BetterLyrics, LrcLib, KuGou, Spotify), com romanização (japonês, coreano, chinês, cirílico, hindi e punjabi) e tradução por IA.

### Contas e serviços
- Entrar no YouTube Music, Spotify, SoundCloud e Last.fm; curtidas e playlists sincronizadas.
- **Discord Rich Presence** sem configurar nada: mostra a música, o tempo e a pausa no seu perfil.
- **Ouvir junto** com salas compatíveis com o MetroFuse e o Metrolist.
- Spotify Canvas sobre a capa (com a conta do Spotify conectada).

### Biblioteca
- Downloads com título, artista, álbum, capa e letra gravados no arquivo.
- Biblioteca local: varre suas pastas, lê as tags e acompanha mudanças.
- Importar playlists de M3U, CSV e links do YouTube Music e do Spotify.
- Backup e restauração.

### Aparência
- Temas, paletas, fundos "Galáxia" e desfocados, idiomas português e inglês.

### Atualizações
- O app avisa quando há versão nova, mostra o que mudou e atualiza com um clique, sem instalador.
