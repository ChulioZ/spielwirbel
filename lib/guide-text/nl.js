'use strict';

/* The „Was spielen wir heute?" guide (#1171) in Dutch, translated from the
   German reference (lib/guide-text/de.js). Content rules: lib/guide.js header.
   « avond » only inside « vanavond » (test/session-naming.test.js scans these
   values), never a device kind (« apparaat », not « telefoon »). */

module.exports = {
  title: 'Wat spelen we vanavond? Zo kiest je groep snel een spel',
  description: 'Een volle kast en geen akkoord? Hoe groepen beslissen wat er op tafel komt, wat er echt toe doet bij de keuze – en een methode die in tien minuten werkt.',
  h1: 'Wat spelen we vanavond?',
  lead: `
        <p>De kast staat vol, iedereen is er, de drankjes staan klaar – en dan begint de discussie. ‘Maakt mij niet uit.’ ‘Als het maar niet weer die lange is.’ ‘Wat hebben we eigenlijk nog meer?’ Twintig minuten later ligt het spel op tafel dat jullie toch altijd spelen, en zitten de nieuwe aanwinsten nog in de folie.</p>
        <p>Deze gids zet op een rij hoe spelgroepen die vraag meestal oplossen, wat er bij de keuze echt toe doet en hoe je in een paar minuten tot een besluit komt waar iedereen mee kan leven – met of zonder app.</p>`,
  sections: [
    {
      h: 'Hoe groepen nu beslissen',
      html: `<p>Bijna elke groep heeft een eigen gewoonte, vaak zonder die ooit te hebben afgesproken. De vier meest voorkomende:</p>
      <ul>
        <li><strong>Om de beurt.</strong> Steeds kiest iemand anders, vaak wie de gastheer of gastvrouw is. Op termijn is dat eerlijk, maar niet voor vandaag: wie het gekozen spel niet leuk vindt, zit het maar uit.</li>
        <li><strong>Wie uitlegt, beslist.</strong> Wie de regels kent, doet een voorstel. Dat scheelt tijd, maar zo bepaalt steeds dezelfde persoon de smaak van de hele groep.</li>
        <li><strong>Het toeval.</strong> Dobbelen, een briefje trekken, een loting-app. Niemand hoeft te kiezen – maar het toeval weet niet dat er vandaag maar twee uur is, of dat iemand een bepaald spel niet kan uitstaan.</li>
        <li><strong>Stemmen.</strong> Handen omhoog of duim omhoog. Snel, maar openlijk: wie het laatst stemt, sluit zich meestal aan bij de meerderheid en stille twijfels raken ondergesneeuwd. Geheim stemmen met briefjes is eerlijker, maar omslachtig – en het telt alleen wat het populairst is, niet wat iemand absoluut niet wil spelen.</li>
      </ul>
      <p>Geen van deze methodes is fout. Ze hebben wel hetzelfde probleem: ze beslissen voordat duidelijk is welke spellen vandaag überhaupt in aanmerking komen.</p>`,
    },
    {
      h: 'Wat er bij de keuze echt toe doet',
      html: `<p>Voordat je het over voorkeuren hebt, loont een korte blik op de harde grenzen. Die strepen meestal al het grootste deel van de kast weg.</p>
      <ul>
        <li><strong>Met hoeveel spelen jullie?</strong> Op de doos staat ‘2–6’, maar veel spellen zijn alleen met een bepaald aantal echt goed. Met z’n vijven een spel kiezen dat met z’n vieren schittert, is voor iedereen minder leuk.</li>
        <li><strong>Hoeveel tijd hebben jullie?</strong> Eerlijk gerekend, inclusief opzetten en uitleg. Een spel dat ‘60–120 minuten’ belooft, duurt met een nieuwe groep zelden maar 60.</li>
        <li><strong>Hoeveel denkkracht is er nog over?</strong> Na een lange week past een licht spel vaak beter dan het zware strategiespel waar stiekem iedereen naar uitkijkt.</li>
        <li><strong>Wie kent de regels?</strong> Een nieuw spel heeft iemand nodig die het uitlegt, en geduld van de rest. Een bekend spel kan meteen beginnen.</li>
        <li><strong>Is er een duidelijk nee?</strong> Een spel dat één persoon echt niet wil spelen, is bijna altijd de slechtere keuze, ook als alle anderen het leuk vinden. Een veto weegt zwaarder dan een lichte voorkeur.</li>
        <li><strong>Is de doos er wel?</strong> Als jullie steeds bij iemand anders afspreken, staat het spel misschien in de verkeerde kast.</li>
      </ul>`,
    },
    {
      h: 'Een methode voor vanavond, in tien minuten',
      html: `<ol>
        <li><strong>Eerst filteren, dan praten.</strong> Streep alles weg wat niet past bij het aantal spelers, de beschikbare tijd of de stemming.</li>
        <li><strong>Trek een korte selectie.</strong> Drie tot vijf spellen is genoeg; meer kandidaten maken de keuze niet beter, alleen langer. Wil niemand kiezen, laat dan het toeval trekken – maar alleen uit wat er na het filteren over is.</li>
        <li><strong>Iedereen beoordeelt elk spel, voor zichzelf.</strong> Een schaal van 1 (‘helemaal niet’) tot 5 (‘heel graag’) volstaat. Het enige wat telt, is dat niemand de antwoorden van de anderen ziet voordat iedereen klaar is.</li>
        <li><strong>Neem het veto serieus.</strong> Een spel met een 1 zakt in de lijst, ook als het gemiddelde er goed uitziet.</li>
        <li><strong>De winnaar komt op tafel.</strong> Het spel met de beste beoordeling wordt gespeeld. Niet nagesteggeld.</li>
      </ol>
      <p>Dit werkt met briefjes en een pen. Het wordt pas lastig als je elke keer opnieuw begint – en precies daarvoor is Spielwirbel er.</p>`,
    },
    {
      h: 'Hoe Spielwirbel het doet',
      html: `<p>Spielwirbel is een webapp voor spelgroepen die deze methode overneemt. Jullie groep legt één keer de spellenkast aan – met de hand of door te zoeken op BoardGameGeek, dat de titel, de cover en het aantal spelers meteen meebrengt.</p>
      <p>Als jullie willen spelen, kies je wie er vandaag aan tafel zit. Spielwirbel loot dan een handvol spellen die precies bij dat aantal spelers passen. Wie wil, perkt vooraf verder in: op de eigen tags van de groep en, bij spellen die aan BoardGameGeek gekoppeld zijn, op speelduur, complexiteit en wat de BoardGameGeek-community voor dat aantal spelers aanraadt. Hebben jullie ingevuld van wie welke doos is, dan blijven spellen buiten beeld waarvan de eigenaar er vandaag niet is.</p>
      <p>Daarna beoordeelt iedereen de gelote spellen van 1 tot 5 – om de beurt op één apparaat dat wordt doorgegeven, of op het eigen apparaat via een gedeelde link of QR-code, zonder account. De beoordelingen blijven geheim tot de stemming wordt gesloten. Dan toont Spielwirbel de ranglijst, en een ‘helemaal niet’ telt zwaarder dan het getal doet vermoeden – zodat er gespeeld wordt waar iedereen zin in heeft.</p>
      <p>Jullie leggen vast wat er gespeeld is en wie er won. Met elke sessie leert jullie groep de eigen smaak beter kennen: welke spellen goed vallen en welke steeds weer op tafel willen.</p>`,
    },
  ],
  cta: {
    title: 'Probeer het zelf',
    demoText: 'De demo opent een kant-en-klare groep met spellen en eerdere sessies – zonder e-mail en zonder wachtwoord. Na een tijdje verwijdert hij zichzelf.',
    demoButton: 'Demo starten',
    openText: 'Spielwirbel werkt in de browser; je hoeft niets te installeren.',
    openButton: 'Spielwirbel openen',
  },
  chrome: {
    note: 'Vertaling – de Duitse versie is de referentietekst.',
    back: '← Naar Spielwirbel',
    faq: 'Veelgestelde vragen',
    langs: 'Talen',
  },
};
