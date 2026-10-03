'use strict';

/* The „Was spielen wir heute?" guide (#1171) in French, translated from the
   German reference (lib/guide-text/de.js). Content rules: lib/guide.js header.
   « soir » only inside « ce soir », never « soirée » (test/session-naming.test.js
   scans these values), never a device kind (« appareil », not « portable »). */

module.exports = {
  title: 'On joue à quoi ce soir ? Choisir vite un jeu en groupe',
  description: 'Une étagère pleine et aucun accord ? Comment les groupes décident ce qui arrive sur la table, ce qui compte vraiment – et une méthode qui marche en dix minutes.',
  h1: 'On joue à quoi ce soir ?',
  lead: `
        <p>L’étagère est pleine, tout le monde est là, les boissons sont servies – et la discussion commence. « Peu importe. » « Tout sauf le long, encore. » « Qu’est-ce qu’on a d’autre ? » Vingt minutes plus tard, c’est le jeu de toujours qui arrive sur la table, et les nouveautés dorment encore sous blister.</p>
        <p>Ce guide rassemble la façon dont les groupes de joueurs règlent d’habitude la question, ce qui compte vraiment dans le choix, et comment arriver en quelques minutes à une décision qui convient à tout le monde – avec ou sans application.</p>`,
  sections: [
    {
      h: 'Comment les groupes décident aujourd’hui',
      html: `<p>Presque chaque groupe a son habitude, souvent sans l’avoir jamais décidée. Les quatre plus courantes :</p>
      <ul>
        <li><strong>Chacun son tour.</strong> Quelqu’un de différent choisit à chaque fois, souvent la personne qui reçoit. C’est juste sur la durée, mais pas pour aujourd’hui : qui n’aime pas le jeu choisi n’a plus qu’à prendre son mal en patience.</li>
        <li><strong>Qui explique, décide.</strong> La personne qui connaît les règles propose. Cela fait gagner du temps, mais c’est toujours la même personne qui façonne le goût de tout le groupe.</li>
        <li><strong>Le hasard.</strong> Un dé, un papier tiré au sort, une appli de tirage. Personne n’a à trancher – mais le hasard ignore que vous n’avez que deux heures aujourd’hui, ou que quelqu’un déteste un jeu précis.</li>
        <li><strong>Le vote.</strong> À main levée ou pouce en l’air. Rapide, mais à découvert : qui vote en dernier suit en général la majorité, et les réticences discrètes passent à la trappe. Un vote secret sur papier est plus honnête, mais laborieux – et il ne compte que ce qui plaît le plus, pas ce que quelqu’un refuse absolument de jouer.</li>
      </ul>
      <p>Aucune de ces méthodes n’est mauvaise. Elles ont pourtant le même défaut : elles décident avant de savoir quels jeux sont vraiment envisageables aujourd’hui.</p>`,
    },
    {
      h: 'Ce qui compte vraiment dans le choix',
      html: `<p>Avant de parler de goûts, jetez un œil aux limites dures. À elles seules, elles écartent en général la plus grande partie de l’étagère.</p>
      <ul>
        <li><strong>Combien êtes-vous ?</strong> La boîte indique « 2–6 », mais beaucoup de jeux ne sont vraiment bons qu’à un nombre précis. Choisir à cinq un jeu qui brille à quatre, c’est moins de plaisir pour tout le monde.</li>
        <li><strong>Combien de temps avez-vous ?</strong> Compté honnêtement, mise en place et explication des règles comprises. Un jeu qui annonce « 60–120 minutes » dure rarement 60 minutes avec un nouveau groupe.</li>
        <li><strong>Combien d’énergie reste-t-il ?</strong> Après une longue semaine, un jeu léger convient souvent mieux que le gros jeu de stratégie dont tout le monde rêve en secret.</li>
        <li><strong>Qui connaît les règles ?</strong> Un nouveau jeu demande quelqu’un pour l’expliquer et de la patience de la part des autres. Un jeu connu peut démarrer tout de suite.</li>
        <li><strong>Y a-t-il un non catégorique ?</strong> Un jeu qu’une personne ne veut vraiment pas jouer est presque toujours le moins bon choix, même si tous les autres l’aiment. Un veto pèse plus qu’une légère préférence.</li>
        <li><strong>La boîte est-elle là ?</strong> Si vous vous retrouvez chez des personnes différentes, le jeu est peut-être sur la mauvaise étagère.</li>
      </ul>`,
    },
    {
      h: 'Une méthode pour ce soir, en dix minutes',
      html: `<ol>
        <li><strong>Filtrer d’abord, discuter ensuite.</strong> Écartez tout ce qui ne colle pas au nombre de joueurs, au temps disponible ou à l’humeur.</li>
        <li><strong>Tirer une courte sélection.</strong> Trois à cinq jeux suffisent ; plus de candidats ne rendent pas le choix meilleur, seulement plus long. Si personne ne veut trancher, laissez le hasard tirer – mais seulement parmi ce qui reste après le filtre.</li>
        <li><strong>Chacun note chaque jeu, de son côté.</strong> Une échelle de 1 (« pas du tout ») à 5 (« à fond ») suffit. L’essentiel est que personne ne voie les réponses des autres avant que tout le monde ait fini.</li>
        <li><strong>Prendre le veto au sérieux.</strong> Un jeu qui a reçu un 1 recule dans la liste, même si sa moyenne semble bonne.</li>
        <li><strong>Le gagnant va sur la table.</strong> On joue le jeu le mieux noté. Pas de renégociation.</li>
      </ol>
      <p>Cela marche avec des bouts de papier et un stylo. Ça ne devient pénible que si vous recommencez de zéro à chaque fois – et c’est exactement pour ça qu’existe Spielwirbel.</p>`,
    },
    {
      h: 'Comment Spielwirbel s’y prend',
      html: `<p>Spielwirbel est une application web pour groupes de joueurs qui reprend cette méthode. Votre groupe crée son étagère une fois – à la main ou en cherchant sur BoardGameGeek, qui apporte le titre, la couverture et le nombre de joueurs.</p>
      <p>Quand vous voulez jouer, vous choisissez qui est à table aujourd’hui. Spielwirbel tire alors au sort une poignée de jeux adaptés exactement à ce nombre de joueurs. Si vous voulez, affinez avant : par les étiquettes propres au groupe et, pour les jeux liés à BoardGameGeek, par durée, complexité et selon ce que la communauté BoardGameGeek recommande pour ce nombre de joueurs. Si vous avez indiqué à qui appartient chaque boîte, les jeux dont les propriétaires sont absents restent de côté.</p>
      <p>Ensuite, chacun note les jeux tirés de 1 à 5 – à tour de rôle sur un appareil qui circule, ou sur son propre appareil via un lien partagé ou un code QR, sans aucun compte. Les notes restent secrètes jusqu’à la clôture du vote. Spielwirbel affiche alors le classement, et un « pas du tout » compte davantage que ne le laisse penser son chiffre – pour qu’on joue à ce qui fait envie à tout le monde.</p>
      <p>Vous notez ce qui a été joué et qui a gagné. À chaque session, votre groupe cerne mieux ses goûts : quels jeux plaisent et lesquels reviennent sans cesse sur la table.</p>`,
    },
  ],
  cta: {
    title: 'Essayez vous-même',
    demoText: 'La démo ouvre un groupe déjà prêt, avec des jeux et des sessions passées – sans e-mail ni mot de passe. Elle s’efface d’elle-même au bout d’un moment.',
    demoButton: 'Lancer la démo',
    openText: 'Spielwirbel fonctionne dans le navigateur ; il n’y a rien à installer.',
    openButton: 'Ouvrir Spielwirbel',
  },
  chrome: {
    note: 'Traduction – la version allemande est le texte de référence.',
    back: '← Vers Spielwirbel',
    faq: 'Questions fréquentes',
    langs: 'Langues',
  },
};
