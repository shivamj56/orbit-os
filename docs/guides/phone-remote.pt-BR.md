# O controle remoto do Orbit no celular, passo a passo

[English](phone-remote.md)

Este guia é para uma TV que já tem o Orbit OS configurado (a tela inicial do Orbit aparece quando você aperta Home).

A partir da versão 1.5, o app aparece em português. As versões anteriores aparecem em inglês: os nomes em inglês estão entre parênteses.

## Antes de começar

- O celular e a TV precisam estar na **mesma rede Wi-Fi de casa**. Uma rede de convidados normalmente bloqueia o acesso do celular à TV.
- A TV precisa estar ligada, ou em espera normal.

## 1. Conectar o celular à TV (só uma vez)

1. Abra o **Orbit** no celular. Ele procura a sua TV no Wi-Fi.
2. Toque no nome da sua TV na lista. Se a lista continuar vazia, digite o endereço da TV (em Configurações › Rede, na TV, por exemplo `192.168.1.20`).
3. A TV mostra um **código de 6 dígitos** no topo da tela inicial do Orbit. Digite esse código no celular.
4. Pronto. O celular guarda a TV, e da próxima vez conecta sozinho.

## 2. A tela do controle

**O globo** funciona em dois modos. Troque entre eles em **Foco** (Focus) e **Cursor**, no topo.

- **Foco** (como um controle normal):
  - Role o globo com o polegar para uma direção para andar um passo: cima, baixo, esquerda ou direita.
  - **Toque** no globo para **OK**.
  - **Segure** para ver os apps recentes.
- **Cursor** (como o touchpad de um notebook, para apps e sites que precisam de um ponteiro):
  - Deslize o dedo para mover o ponteiro na TV.
  - Toque para clicar.
  - Use dois dedos para rolar.

**Abaixo do globo:** **Voltar** (Back), **Início** (Home) e **Recentes** (Recent).

**A barra de baixo:**
- Volume menos, o nível e volume mais. Toque no nível para tirar o som.
- **Teclado** (Keyboard): digite na TV pelo celular, o que é muito mais rápido para buscas.
- **Apps**: abra qualquer app da TV.
- **Suspender** (Sleep): desliga a TV.

**O cartão no topo** mostra o que está tocando. Toque nele para pausar, tocar ou pular.

**Os botões de volume do próprio celular** mudam o volume da TV enquanto o Orbit está aberto. Dá para desligar isso em Configurações.

**Configurações** (Settings, a engrenagem) tem:
- **Idioma**: o Orbit segue o idioma do seu celular. Escolha outro aqui; são cerca de 80.
- a velocidade do ponteiro,
- os botões de volume,
- a troca entre as telas iniciais da TV,
- os backups,
- **Esquecer esta TV** (Forget this TV).

Dica: no modo Cursor, uma velocidade de ponteiro menor em Configurações facilita acertar botões pequenos.

## 3. "Não foi possível conectar à TV" (Can't reach the TV)

Tente nesta ordem:

1. Confira se a TV está ligada e se o celular está no mesmo Wi-Fi da TV, depois toque em **Tentar novamente** (Try again).
2. **O roteador reiniciou?** O roteador pode ter dado um novo endereço para a TV.
   - A próxima versão do Orbit encontra a TV de novo sozinha, em uns 15 segundos.
   - Nas versões anteriores: abra Configurações › **Esquecer esta TV**, escolha a TV de novo na lista e digite o novo código.
   - Para isso não acontecer mais, dê um endereço fixo para a TV no roteador. Procure a opção "reserva de DHCP" ou "IP fixo".
3. Aperte **Home** no controle da própria TV uma vez, para que a tela inicial do Orbit (e a conexão dela com o celular) esteja rodando.

## 4. Layout e papéis de parede

Hoje o Orbit Home tem um único layout, e ainda não dá para usar um papel de parede próprio. Os dois estão no [roadmap](../roadmap.md). Se você quiser construir isso, veja o [CONTRIBUTING](../../CONTRIBUTING.md). O código da tela inicial fica em `launcher/`.

## 5. Desfazer

Configurações › **Desfazer o Orbit OS nesta TV** (Undo Orbit OS on this TV) volta a TV ao que era antes do Orbit: a tela inicial original e todos os apps que foram desligados. Nada é apagado em momento nenhum.
