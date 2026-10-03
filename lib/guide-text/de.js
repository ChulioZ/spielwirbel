'use strict';

/* The REFERENCE text of the „Was spielen wir heute?" guide (#1171) — every other
   language is translated from this one. Content rules: lib/guide.js header.
   No „Abend" anywhere (test/session-naming.test.js scans this file's values —
   „heute" says when, without naming the entity), no device kind
   (test/guide.test.js), nothing an instance cannot honestly claim. */

module.exports = {
  title: 'Was spielen wir heute? So findet eure Runde schnell ein Spiel',
  description: 'Volles Regal, keine Einigung? Wie Gruppen entscheiden, was auf den Tisch kommt, worauf es bei der Wahl ankommt – und eine Methode, die in zehn Minuten klappt.',
  h1: 'Was spielen wir heute?',
  lead: `
        <p>Das Regal ist voll, alle sind da, die Getränke stehen – und dann beginnt die Diskussion. „Mir egal.“ „Hauptsache nicht wieder das lange.“ „Was haben wir eigentlich noch?“ Zwanzig Minuten später liegt das Spiel auf dem Tisch, das ohnehin immer gespielt wird, und die Neuanschaffungen stehen weiter in Folie im Schrank.</p>
        <p>Dieser Ratgeber sammelt, wie Spielegruppen diese Frage üblicherweise lösen, worauf es bei der Auswahl wirklich ankommt und wie ihr in wenigen Minuten zu einer Entscheidung kommt, mit der alle leben können – mit oder ohne App.</p>`,
  sections: [
    {
      h: 'Wie Gruppen sich heute entscheiden',
      html: `<p>Fast jede Runde hat ihre eigene Gewohnheit, oft ohne sie je beschlossen zu haben. Die vier häufigsten:</p>
      <ul>
        <li><strong>Reihum.</strong> Jedes Mal bestimmt jemand anderes, oft die Person, bei der ihr euch trefft. Über die Zeit ist das fair, für den heutigen Tag aber nicht: Wer das gewählte Spiel nicht mag, sitzt es eben aus.</li>
        <li><strong>Wer erklärt, entscheidet.</strong> Die Person, die die Regeln kennt, schlägt vor. Das spart Zeit, führt aber dazu, dass immer dieselbe Person den Geschmack der ganzen Gruppe prägt.</li>
        <li><strong>Der Zufall.</strong> Würfeln, Zettel ziehen, eine Zufalls-App. Niemand muss sich festlegen – doch der Zufall weiß nicht, dass heute nur zwei Stunden Zeit sind oder dass jemand ein bestimmtes Spiel überhaupt nicht ausstehen kann.</li>
        <li><strong>Abstimmen.</strong> Handzeichen oder Daumen hoch. Schnell, aber offen: Wer zuletzt abstimmt, schließt sich meist der Mehrheit an, und leise Bedenken gehen unter. Eine geheime Abstimmung mit Zetteln ist ehrlicher, aber umständlich – und sie zählt nur, was am beliebtesten ist, nicht, was jemand auf keinen Fall spielen will.</li>
      </ul>
      <p>Keine dieser Methoden ist falsch. Sie haben aber dasselbe Problem: Sie entscheiden, bevor klar ist, welche Spiele heute überhaupt in Frage kommen.</p>`,
    },
    {
      h: 'Worauf es bei der Wahl wirklich ankommt',
      html: `<p>Bevor ihr über Vorlieben redet, lohnt sich ein kurzer Blick auf die harten Grenzen. Sie streichen meist schon den größten Teil des Regals.</p>
      <ul>
        <li><strong>Wie viele spielen mit?</strong> Auf der Schachtel steht „2–6“, aber viele Spiele sind nur mit einer bestimmten Zahl richtig gut. Zu fünft ein Spiel zu wählen, das zu viert glänzt, macht allen weniger Spaß.</li>
        <li><strong>Wie viel Zeit habt ihr?</strong> Ehrlich gerechnet, mit Aufbau und Regelerklärung. Ein Spiel, das „60–120 Minuten“ verspricht, dauert in einer neuen Runde selten nur 60.</li>
        <li><strong>Wie viel Kopf ist heute übrig?</strong> Nach einer langen Woche passt ein leichtes Spiel oft besser als das schwere Strategiespiel, auf das sich eigentlich alle freuen.</li>
        <li><strong>Wer kennt die Regeln?</strong> Ein neues Spiel braucht jemanden, der es erklärt, und Geduld bei allen anderen. Ein bekanntes Spiel kann sofort losgehen.</li>
        <li><strong>Gibt es ein klares Nein?</strong> Ein Spiel, das eine Person wirklich nicht spielen will, ist fast immer die schlechtere Wahl, selbst wenn alle anderen es mögen. Ein Veto wiegt schwerer als eine leichte Vorliebe.</li>
        <li><strong>Ist die Schachtel überhaupt da?</strong> Wenn ihr euch reihum bei verschiedenen Leuten trefft, steht das Spiel womöglich im falschen Regal.</li>
      </ul>`,
    },
    {
      h: 'Eine Methode für heute, in zehn Minuten',
      html: `<ol>
        <li><strong>Erst filtern, dann reden.</strong> Streicht alles, was nicht zur Personenzahl, zur verfügbaren Zeit oder zur Stimmung passt.</li>
        <li><strong>Eine kurze Auswahl ziehen.</strong> Drei bis fünf Spiele reichen; mehr Kandidaten machen die Wahl nicht besser, nur länger. Wer sich nicht festlegen will, lässt den Zufall ziehen – aber nur aus dem, was nach dem Filtern übrig ist.</li>
        <li><strong>Alle bewerten jedes Spiel, für sich.</strong> Eine Skala von 1 („gar nicht“) bis 5 („unbedingt“) genügt. Wichtig ist nur, dass niemand die Antworten der anderen sieht, bevor alle fertig sind.</li>
        <li><strong>Das Veto ernst nehmen.</strong> Ein Spiel mit einer 1 rutscht nach hinten, auch wenn sein Durchschnitt gut aussieht.</li>
        <li><strong>Der Sieger kommt auf den Tisch.</strong> Das Spiel mit der besten Wertung wird gespielt. Kein Nachverhandeln.</li>
      </ol>
      <p>Das funktioniert mit Zetteln und einem Stift. Mühsam wird es nur, wenn ihr es jedes Mal von vorn macht – und genau dafür gibt es Spielwirbel.</p>`,
    },
    {
      h: 'Wie Spielwirbel das macht',
      html: `<p>Spielwirbel ist eine Web-App für Spielegruppen, die diese Methode übernimmt. Eure Runde legt einmal ihr Regal an – von Hand oder per Suche bei BoardGameGeek, die Titel, Cover und Personenzahl gleich mitbringt.</p>
      <p>Wenn ihr spielen wollt, wählt ihr aus, wer heute am Tisch sitzt. Spielwirbel zieht dann eine Handvoll Spiele, die zu genau dieser Personenzahl passen. Wer möchte, grenzt vorher weiter ein: nach den eigenen Schlagworten der Runde und, bei Spielen mit BoardGameGeek-Verknüpfung, nach Spieldauer, Komplexität und danach, was die BoardGameGeek-Community für diese Personenzahl empfiehlt. Habt ihr eingetragen, wem welche Schachtel gehört, bleiben Spiele außen vor, deren Besitzer heute nicht dabei sind.</p>
      <p>Dann bewertet jede Person die gezogenen Spiele von 1 bis 5 – reihum an einem Gerät, das weitergegeben wird, oder auf dem eigenen Gerät über einen geteilten Link oder QR-Code, ganz ohne Konto. Die Wertungen bleiben geheim, bis die Abstimmung beendet wird. Dann zeigt Spielwirbel die Rangliste, und ein „gar nicht“ zählt dabei stärker, als sein Zahlenwert vermuten lässt – damit gespielt wird, worauf alle Lust haben.</p>
      <p>Ihr haltet fest, was gespielt wurde und wer gewonnen hat. Mit jeder Session lernt eure Runde ihren Geschmack besser kennen: welche Spiele gut ankommen und welche immer wieder auf den Tisch wollen.</p>`,
    },
  ],
  cta: {
    title: 'Selbst ausprobieren',
    demoText: 'Die Demo öffnet eine fertig eingerichtete Runde mit Spielen und vergangenen Sessions – ohne E-Mail und ohne Passwort. Sie löscht sich nach einiger Zeit von selbst.',
    demoButton: 'Demo starten',
    openText: 'Spielwirbel läuft im Browser; installieren müsst ihr nichts.',
    openButton: 'Spielwirbel öffnen',
  },
  chrome: {
    note: null,
    back: '← Zu Spielwirbel',
    faq: 'Häufige Fragen',
    langs: 'Sprachen',
  },
};
