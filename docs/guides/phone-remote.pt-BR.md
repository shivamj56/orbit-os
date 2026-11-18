# O controle remoto do Orbit no celular, passo a passo

[English](phone-remote.md)

Este guia é para uma TV que já tem o Orbit OS configurado (a tela inicial do Orbit aparece quando você aperta Home).

## Antes de começar

- O celular e a TV precisam estar na **mesma rede Wi-Fi de casa**. Uma rede de convidados normalmente bloqueia o acesso do celular à TV.
- A TV precisa estar ligada, ou em espera normal.

## 1. Conectar o celular à TV (só uma vez)

1. Abra o **Orbit** no celular. Ele procura a sua TV no Wi-Fi.
2. Toque no nome da sua TV na lista. Se a lista continuar vazia, digite o endereço da TV (em Configurações › Rede, na TV, por exemplo `192.168.1.20`).
3. A TV mostra um **código de 6 dígitos** no topo da tela inicial do Orbit. Digite esse código no celular.
4. Pronto. O celular guarda a TV, e da próxima vez conecta sozinho.

## 2. A tela do controle

**O globo** funciona em dois modos. Troque entre eles em **Focus** e **Cursor**, no topo.

- **Focus** (como um controle normal):
  - Role o globo com o polegar para uma direção para andar um passo: cima, baixo, esquerda ou direita.
  - **Toque** no globo para **OK**.
  - **Segure** para ver os apps recentes.
- **Cursor** (como o touchpad de um notebook, para apps e sites que precisam de um ponteiro):
  - Deslize o dedo para mover o ponteiro na TV.
  - Toque para clicar.
  - Use dois dedos para rolar.

**Abaixo do globo:** **Back** (voltar), **Home** (início) e **Recent** (recentes).

**A barra de baixo:**
- Volume menos, o nível e volume mais. Toque no nível para tirar o som.
- **Keyboard** (teclado): digite na TV pelo celular, o que é muito mais rápido para buscas.
- **Apps**: abra qualquer app da TV.
- **Sleep**: desliga a TV.

**O cartão no topo** mostra o que está tocando. Toque nele para pausar, tocar ou pular.

**Os botões de volume do próprio celular** mudam o volume da TV enquanto o Orbit está aberto. Dá para desligar isso em Settings.

**Settings** (a engrenagem) tem:
- a velocidade do ponteiro,
- os botões de volume,
- a troca entre as telas iniciais da TV,
- os backups,
- **Forget this TV** (esquecer esta TV).

Dica: no modo Cursor, uma velocidade de ponteiro menor em Settings facilita acertar botões pequenos.

## 3. "Can't reach the TV" (não consigo alcançar a TV)

Tente nesta ordem:

1. Confira se a TV está ligada e se o celular está no mesmo Wi-Fi da TV, depois toque em **Try again** (tentar de novo).
2. **O roteador reiniciou?** O roteador pode ter dado um novo endereço para a TV.
   - A próxima versão do Orbit encontra a TV de novo sozinha, em uns 15 segundos.
   - Nas versões anteriores: abra Settings › **Forget this TV**, escolha a TV de novo na lista e digite o novo código.
   - Para isso não acontecer mais, dê um endereço fixo para a TV no roteador. Procure a opção "reserva de DHCP" ou "IP fixo".
3. Aperte **Home** no controle da própria TV uma vez, para que a tela inicial do Orbit (e a conexão dela com o celular) esteja rodando.

## 4. Layout e papéis de parede

Hoje o Orbit Home tem um único layout, e ainda não dá para usar um papel de parede próprio. Os dois estão no [roadmap](../roadmap.md). Se você quiser construir isso, veja o [CONTRIBUTING](../../CONTRIBUTING.md). O código da tela inicial fica em `launcher/`.

## 5. Desfazer

Settings › **Undo Orbit OS on this TV** (desfazer o Orbit OS nesta TV) volta a TV ao que era antes do Orbit: a tela inicial original e todos os apps que foram desligados. Nada é apagado em momento nenhum.
