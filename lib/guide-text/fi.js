'use strict';

/* The „Was spielen wir heute?" guide (#1171) in Finnish, translated from the
   German reference (lib/guide-text/de.js). Content rules: lib/guide.js header.
   No word starting with « ilta » and no « illan » (test/session-naming.test.js
   scans these values — « tänään » says when without naming the entity), never a
   device kind (« laite », not « puhelin »). */

module.exports = {
  title: 'Mitä pelataan tänään? Näin porukka valitsee pelin nopeasti',
  description: 'Hylly täynnä eikä yksimielisyyttä? Miten porukat päättävät, mikä peli pöytään tulee, mikä valinnassa oikeasti ratkaisee – ja tapa, joka toimii kymmenessä minuutissa.',
  h1: 'Mitä pelataan tänään?',
  lead: `
        <p>Hylly on täynnä, kaikki ovat paikalla, juomat on katettu – ja sitten alkaa keskustelu. ”Ihan sama.” ”Kunhan ei taas sitä pitkää.” ”Mitä muuta meillä on?” Kahdenkymmenen minuutin päästä pöydällä on se peli, jota pelataan aina, ja uudet hankinnat ovat yhä muoveissaan.</p>
        <p>Tähän oppaaseen on koottu, miten peliporukat tavallisesti ratkaisevat kysymyksen, mikä valinnassa oikeasti ratkaisee ja miten pääsette muutamassa minuutissa päätökseen, jonka kanssa kaikki voivat elää – sovelluksen kanssa tai ilman.</p>`,
  sections: [
    {
      h: 'Miten porukat päättävät nyt',
      html: `<p>Lähes jokaisella porukalla on oma tapansa, usein ilman että siitä olisi koskaan sovittu. Neljä yleisintä:</p>
      <ul>
        <li><strong>Vuorotellen.</strong> Joka kerta valitsee joku muu, usein se, jonka luona tavataan. Pitkällä aikavälillä se on reilua, mutta ei tämän päivän kannalta: jos valittu peli ei maistu, sen vain istuu läpi.</li>
        <li><strong>Joka selittää, se päättää.</strong> Säännöt tunteva ehdottaa. Se säästää aikaa, mutta silloin aina sama ihminen muovaa koko porukan makua.</li>
        <li><strong>Sattuma.</strong> Noppa, arvottu lappu, arvontasovellus. Kenenkään ei tarvitse sitoutua – mutta sattuma ei tiedä, että tänään on vain kaksi tuntia aikaa tai että joku ei siedä tiettyä peliä lainkaan.</li>
        <li><strong>Äänestys.</strong> Käsi ylös tai peukku pystyyn. Nopeaa mutta avointa: viimeisenä äänestävä yleensä myötäilee enemmistöä, ja hiljaiset epäilykset hukkuvat. Salainen lippuäänestys on rehellisempi mutta kömpelö – ja se laskee vain suosituimman, ei sitä, mitä joku ei missään nimessä halua pelata.</li>
      </ul>
      <p>Mikään näistä tavoista ei ole väärä. Niillä on kuitenkin sama ongelma: ne päättävät ennen kuin on selvää, mitkä pelit tänään ylipäätään tulevat kyseeseen.</p>`,
    },
    {
      h: 'Mikä valinnassa oikeasti ratkaisee',
      html: `<p>Ennen kuin puhutte mieltymyksistä, kannattaa vilkaista kovia rajoja. Ne karsivat yleensä jo suurimman osan hyllystä.</p>
      <ul>
        <li><strong>Montako pelaa?</strong> Laatikossa lukee ”2–6”, mutta moni peli on todella hyvä vain tietyllä pelaajamäärällä. Jos viisi valitsee pelin, joka loistaa neljällä, kaikilla on vähemmän hauskaa.</li>
        <li><strong>Paljonko aikaa on?</strong> Rehellisesti laskettuna, pystytys ja sääntöjen selitys mukaan lukien. Peli, joka lupaa ”60–120 minuuttia”, kestää uudella porukalla harvoin vain 60.</li>
        <li><strong>Paljonko ajatustyötä jaksaa?</strong> Pitkän viikon jälkeen kevyt peli sopii usein paremmin kuin se raskas strategiapeli, jota kaikki salaa odottavat.</li>
        <li><strong>Kuka osaa säännöt?</strong> Uusi peli tarvitsee jonkun selittämään sen ja muilta kärsivällisyyttä. Tuttu peli voi alkaa heti.</li>
        <li><strong>Onko selvä ei?</strong> Peli, jota yksi ihminen ei todellakaan halua pelata, on lähes aina huonompi valinta, vaikka kaikki muut pitäisivät siitä. Veto painaa enemmän kuin lievä mieltymys.</li>
        <li><strong>Onko laatikko edes täällä?</strong> Jos tapaatte vuorotellen eri ihmisten luona, peli voi olla väärässä hyllyssä.</li>
      </ul>`,
    },
    {
      h: 'Tapa tälle päivälle, kymmenessä minuutissa',
      html: `<ol>
        <li><strong>Ensin rajaus, sitten puhe.</strong> Karsikaa kaikki, mikä ei sovi pelaajamäärään, käytettävissä olevaan aikaan tai tunnelmaan.</li>
        <li><strong>Arpokaa lyhyt lista.</strong> Kolmesta viiteen peliä riittää; useampi ehdokas ei tee valinnasta parempaa, vain pidemmän. Jos kukaan ei halua sitoutua, antakaa sattuman arpoa – mutta vain siitä, mitä rajauksen jälkeen jäi.</li>
        <li><strong>Jokainen arvioi jokaisen pelin, itsekseen.</strong> Asteikko 1 (”en lainkaan”) – 5 (”ehdottomasti”) riittää. Tärkeintä on, ettei kukaan näe muiden vastauksia ennen kuin kaikki ovat valmiita.</li>
        <li><strong>Ottakaa veto vakavasti.</strong> Peli, joka sai ykkösen, putoaa listalla, vaikka sen keskiarvo näyttäisi hyvältä.</li>
        <li><strong>Voittaja pöytään.</strong> Pelataan se, jolla on paras arvio. Ei jälkineuvotteluja.</li>
      </ol>
      <p>Tämä toimii lapuilla ja kynällä. Työlääksi se muuttuu vasta, jos aloitatte joka kerta alusta – ja juuri sitä varten on Spielwirbel.</p>`,
    },
    {
      h: 'Näin Spielwirbel sen tekee',
      html: `<p>Spielwirbel on peliporukoille tehty verkkosovellus, joka hoitaa tämän tavan. Porukkanne kokoaa hyllynsä kerran – käsin tai hakemalla BoardGameGeekistä, joka tuo mukanaan nimen, kansikuvan ja pelaajamäärän.</p>
      <p>Kun haluatte pelata, valitsette, ketkä istuvat tänään pöydässä. Spielwirbel arpoo sitten kourallisen pelejä, jotka sopivat juuri siihen pelaajamäärään. Halutessanne voitte rajata ensin lisää: porukan omilla tunnisteilla ja BoardGameGeekiin linkitetyissä peleissä peliajan, vaikeustason ja sen mukaan, mitä BoardGameGeekin yhteisö suosittelee tälle pelaajamäärälle. Jos olette merkinneet, kenelle mikin laatikko kuuluu, pois jäävät pelit, joiden omistajat eivät ole tänään paikalla.</p>
      <p>Sitten jokainen arvioi arvotut pelit asteikolla 1–5 – vuorotellen yhdellä laitteella, joka kiertää kädestä käteen, tai omalla laitteellaan jaetun linkin tai QR-koodin kautta, ilman tiliä. Arviot pysyvät salaisina, kunnes äänestys suljetaan. Silloin Spielwirbel näyttää järjestyksen, ja ”en lainkaan” painaa enemmän kuin sen numero antaa ymmärtää – jotta pelataan sitä, mikä kaikkia huvittaa.</p>
      <p>Kirjaatte, mitä pelattiin ja kuka voitti. Jokaisen session myötä porukkanne tuntee makunsa paremmin: mitkä pelit uppoavat ja mitkä palaavat pöytään yhä uudelleen.</p>`,
    },
  ],
  cta: {
    title: 'Kokeile itse',
    demoText: 'Demo avaa valmiiksi kootun porukan peleineen ja aiempine sessioineen – ilman sähköpostia ja salasanaa. Se poistuu itsestään jonkin ajan kuluttua.',
    demoButton: 'Aloita demo',
    openText: 'Spielwirbel toimii selaimessa; mitään ei tarvitse asentaa.',
    openButton: 'Avaa Spielwirbel',
  },
  chrome: {
    note: 'Käännös – saksankielinen versio on lähdeteksti.',
    back: '← Spielwirbeliin',
    faq: 'Usein kysytyt kysymykset',
    langs: 'Kielet',
  },
};
