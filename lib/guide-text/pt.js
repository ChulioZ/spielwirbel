'use strict';

/* The „Was spielen wir heute?" guide (#1171) in Portuguese (Brazil), translated
   from the German reference (lib/guide-text/de.js). Content rules: lib/guide.js
   header. « noite » only inside « hoje à noite » (test/session-naming.test.js
   scans these values), never a device kind (« aparelho », not « celular »). */

module.exports = {
  title: 'O que vamos jogar hoje? Como o grupo escolhe um jogo rápido',
  description: 'Estante cheia e nenhum acordo? Como os grupos decidem o que vai para a mesa, o que realmente importa na escolha – e um método que funciona em dez minutos.',
  h1: 'O que vamos jogar hoje?',
  lead: `
        <p>A estante está cheia, todo mundo chegou, as bebidas estão na mesa – e começa a discussão. “Tanto faz.” “Só não aquele demorado de novo.” “O que mais a gente tem?” Vinte minutos depois, o jogo na mesa é o de sempre, e as novidades continuam no plástico.</p>
        <p>Este guia reúne como os grupos de jogo costumam resolver a questão, o que realmente importa na hora de escolher e como chegar em poucos minutos a uma decisão com que todo mundo consiga conviver – com ou sem app.</p>`,
  sections: [
    {
      h: 'Como os grupos decidem hoje',
      html: `<p>Quase todo grupo tem seu costume, muitas vezes sem nunca ter combinado. Os quatro mais comuns:</p>
      <ul>
        <li><strong>Revezamento.</strong> A cada vez alguém diferente escolhe, muitas vezes quem está recebendo. Com o tempo é justo, mas não para hoje: quem não gosta do jogo escolhido simplesmente aguenta.</li>
        <li><strong>Quem explica, decide.</strong> Quem conhece as regras sugere. Economiza tempo, mas faz com que sempre a mesma pessoa molde o gosto do grupo inteiro.</li>
        <li><strong>O acaso.</strong> Rolar um dado, tirar um papelzinho, um app de sorteio. Ninguém precisa se comprometer – mas o acaso não sabe que hoje só há duas horas, ou que alguém não suporta um jogo específico.</li>
        <li><strong>Votação.</strong> Mão levantada ou joinha. Rápido, mas aberto: quem vota por último costuma seguir a maioria, e as dúvidas mais discretas se perdem. Uma votação secreta com papeizinhos é mais honesta, mas trabalhosa – e só conta o que é mais popular, não o que alguém não quer jogar de jeito nenhum.</li>
      </ul>
      <p>Nenhum desses métodos está errado. Mas todos têm o mesmo problema: decidem antes de ficar claro quais jogos fazem sentido hoje.</p>`,
    },
    {
      h: 'O que realmente importa na escolha',
      html: `<p>Antes de falar de preferências, vale dar uma olhada nos limites rígidos. Sozinhos, eles costumam eliminar a maior parte da estante.</p>
      <ul>
        <li><strong>Quantas pessoas vão jogar?</strong> A caixa diz “2–6”, mas muitos jogos só são bons de verdade com um número específico. Escolher com cinco pessoas um jogo que brilha com quatro é menos divertido para todo mundo.</li>
        <li><strong>Quanto tempo vocês têm?</strong> Contando com honestidade, incluindo montagem e explicação. Um jogo que promete “60–120 minutos” raramente dura só 60 com um grupo novo.</li>
        <li><strong>Quanta energia sobrou?</strong> Depois de uma semana longa, um jogo leve costuma combinar mais do que aquele jogo de estratégia pesado que, no fundo, todo mundo está esperando.</li>
        <li><strong>Quem conhece as regras?</strong> Um jogo novo precisa de alguém que explique e de paciência de todos os outros. Um conhecido pode começar na hora.</li>
        <li><strong>Existe um não claro?</strong> Um jogo que uma pessoa realmente não quer jogar quase sempre é a pior escolha, mesmo que todos os outros gostem. Um veto pesa mais do que uma leve preferência.</li>
        <li><strong>A caixa está aqui?</strong> Se vocês se encontram na casa de pessoas diferentes, o jogo pode estar na estante errada.</li>
      </ul>`,
    },
    {
      h: 'Um método para hoje, em dez minutos',
      html: `<ol>
        <li><strong>Primeiro filtrar, depois conversar.</strong> Risquem tudo o que não combina com o número de pessoas, o tempo disponível ou o clima.</li>
        <li><strong>Sortear uma lista curta.</strong> De três a cinco jogos bastam; mais candidatos não deixam a escolha melhor, só mais longa. Se ninguém quiser se comprometer, deixem o acaso sortear – mas só entre o que sobrou depois do filtro.</li>
        <li><strong>Cada pessoa avalia cada jogo, sozinha.</strong> Uma escala de 1 (“nenhuma”) a 5 (“muita”) basta. O importante é que ninguém veja as respostas dos outros antes de todo mundo terminar.</li>
        <li><strong>Levar o veto a sério.</strong> Um jogo com nota 1 desce na lista, mesmo que a média pareça boa.</li>
        <li><strong>O vencedor vai para a mesa.</strong> Joga-se o que tiver a melhor avaliação. Sem renegociar.</li>
      </ol>
      <p>Isso funciona com papeizinhos e uma caneta. Só fica cansativo quando vocês começam do zero toda vez – e é exatamente para isso que existe o Spielwirbel.</p>`,
    },
    {
      h: 'Como o Spielwirbel faz isso',
      html: `<p>O Spielwirbel é um app web para grupos de jogo que assume esse método. O grupo monta a estante uma vez – à mão ou buscando no BoardGameGeek, que já traz título, capa e número de jogadores.</p>
      <p>Na hora de jogar, vocês escolhem quem está à mesa hoje. O Spielwirbel então sorteia um punhado de jogos que se encaixam exatamente nesse número de pessoas. Se quiserem, restrinjam antes: pelas tags próprias do grupo e, nos jogos vinculados ao BoardGameGeek, por duração, complexidade e pelo que a comunidade do BoardGameGeek recomenda para esse número de jogadores. Se vocês registraram de quem é cada caixa, ficam de fora os jogos cujos donos não estão hoje.</p>
      <p>Depois, cada pessoa avalia os jogos sorteados de 1 a 5 – em turnos num aparelho que vai passando de mão em mão, ou no próprio aparelho por um link compartilhado ou um código QR, sem conta nenhuma. As avaliações ficam em segredo até a votação ser encerrada. Aí o Spielwirbel mostra o ranking, e um “nenhuma” pesa mais do que o número sugere – para que se jogue aquilo que todo mundo está a fim de jogar.</p>
      <p>Vocês registram o que foi jogado e quem ganhou. A cada sessão o grupo conhece melhor o próprio gosto: quais jogos agradam e quais sempre voltam para a mesa.</p>`,
    },
  ],
  cta: {
    title: 'Experimente você mesmo',
    demoText: 'A demo abre um grupo já pronto, com jogos e sessões anteriores – sem e-mail e sem senha. Ela se apaga sozinha depois de um tempo.',
    demoButton: 'Iniciar a demo',
    openText: 'O Spielwirbel funciona no navegador; não é preciso instalar nada.',
    openButton: 'Abrir o Spielwirbel',
  },
  chrome: {
    note: 'Tradução – a versão alemã é o texto de referência.',
    back: '← Para o Spielwirbel',
    faq: 'Perguntas frequentes',
    langs: 'Idiomas',
  },
};
