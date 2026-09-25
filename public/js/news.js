/* Spielwirbel – the „Was ist neu" entry list (issue #741).

   The content behind the /neu screen and the unseen dot on the account button.
   A CODE CONSTANT rather than an operator-authored table on purpose: an entry
   stored in the database would announce features a self-hoster's deployed
   version does not have, while a constant ships WITH the release it describes.
   So an older instance simply shows the list that shipped with it — no version
   negotiation, no "coming soon" entries.

   Kept dependency-free with the module.exports guard: lib/routes/account.js
   requires this file so the server, not the client, decides which revision a
   "seen" stamp records (.claude/rules/shared-constants-across-the-stack.md).

   Modelled on TERMS_CHANGELOG (lib/legal.js), which already solved this exact
   shape: newest first, the text inline in the entry rather than behind i18n keys
   — one entry is then one edit, and test/i18n-parity.test.js never has to care —
   and trimmed to roughly the last ten.

   EVERY SHIPPED LOCALE, INLINE (#1087). It was German and English only until the
   other seven had all shipped, at which point a reader who had switched the whole
   UI to Finnish or Korean opened „Was ist neu" and got English — the one screen
   in the app that did that. The design that keeps this list out of lang/*.js is
   also what kept anything from noticing, so test/news-locales.test.js derives the
   required set from public/js/locales.js: a tenth language cannot ship without
   its news, and an entry carrying an unknown code (a `kr:` typo) fails rather
   than silently falling back. Translate the product vocabulary the way the
   matching lang/<code>.js does — look Regal, Chronik, Pokale, Freundeskreis and
   Entdecken up in that table rather than translating them fresh, or the entry
   names a screen the reader cannot find. „Spielwirbel" and „Session" stay as
   they are in every language.

   THE BAR FOR ADDING AN ENTRY IS HIGH, and it is stated in
   .claude/rules/keep-readme-current.md: a genuinely new user-facing CAPABILITY,
   nothing else. Every entry spends attention the Nutzungsbedingungen §11 terms
   notice also needs, so this list is a budget, not a log.

   EVERY ENTRY HAS A `kind` (#1281): 'new' for a capability that did not exist,
   'improved' for an existing one that now does more, 'fixed' for a repair big
   enough to clear the bar above (rare by construction). Der Tisch prints it as
   a „Neu / Besser / Behoben" badge (`news.kind.*` in lang/*.js); Klassisch
   does not render it. test/tisch-news-stats-disc.test.js makes it required. */

'use strict';

// Deliberately NOT seeded with past releases (same call TERMS_CHANGELOG made):
// seeding would dot every existing account about features most of them joined
// AFTER, which is the exact unearned interruption this design exists to avoid.
const NEWS = [
  /*
   * #1328. A capability that did not exist: a round remembered exactly ONE
   * draw (the last), so a group with two recurring evenings re-picked the other
   * one every time. Dated the day after the flip's entry, because an equal date
   * would leave every account that has read the flip without the dot.
   */
  {
    revision: '2026-09-26',
    kind: 'new',
    de: {
      title: 'Filter speichern',
      body: 'Zieht eure Runde immer wieder auf dieselbe Art? Stellt die Session '
        + 'einmal ein — Tags, Filter, Anzahl und wer mitspielt — und tippt auf '
        + '„Filter speichern". Gespeicherte Filter erscheinen auf dem Start als '
        + 'Schnellstart, für alle in der Runde, und öffnen „Session wirbeln" mit '
        + 'allem schon eingestellt. Umbenennen, sortieren und löschen könnt ihr '
        + 'sie in den Einstellungen der Runde.',
    },
    en: {
      title: 'Save your filters',
      body: 'Does your round keep drawing the same way? Set the session up once — '
        + 'tags, filters, count and who is playing — and tap „Save filter". Saved '
        + 'filters appear on Start as quick-start chips, for everyone in the round, '
        + 'and open „Start session" with everything already set. Rename, reorder '
        + 'and delete them in the round\'s Settings.',
    },
    es: {
      title: 'Guarda tus filtros',
      body: '¿Vuestro grupo sortea siempre de la misma manera? Configurad la '
        + 'sesión una vez —etiquetas, filtros, cantidad y quién juega— y tocad '
        + '«Guardar filtro». Los filtros guardados aparecen en Inicio como inicio '
        + 'rápido, para todo el grupo, y abren «Sortear sesión» con todo listo. '
        + 'Podéis cambiarles el nombre, ordenarlos y eliminarlos en los Ajustes '
        + 'del grupo.',
    },
    fr: {
      title: 'Enregistrez vos filtres',
      body: 'Votre groupe tire toujours de la même façon ? Réglez la session une '
        + 'fois — étiquettes, filtres, nombre et qui joue — puis touchez « '
        + 'Enregistrer le filtre ». Les filtres enregistrés apparaissent dans '
        + 'Démarrer en démarrage rapide, pour tout le groupe, et ouvrent « Démarrer '
        + 'une session » avec tout déjà réglé. Renommez-les, triez-les et '
        + 'supprimez-les dans les Réglages du groupe.',
    },
    it: {
      title: 'Salva i tuoi filtri',
      body: 'Il vostro gruppo estrae sempre allo stesso modo? Impostate la '
        + 'sessione una volta — etichette, filtri, numero e chi gioca — e toccate '
        + '«Salva filtro». I filtri salvati compaiono in Avvia come avvio rapido, '
        + 'per tutto il gruppo, e aprono «Avvia una sessione» con tutto già '
        + 'impostato. Rinominateli, riordinateli ed eliminateli nelle '
        + 'Impostazioni del gruppo.',
    },
    nl: {
      title: 'Filters opslaan',
      body: 'Trekt jullie groep steeds op dezelfde manier? Stel de sessie één keer '
        + 'in — labels, filters, aantal en wie meespeelt — en tik op „Filter '
        + 'opslaan". Opgeslagen filters staan bij Start als snelle start, voor '
        + 'iedereen in de groep, en openen „Sessie starten" met alles al ingesteld. '
        + 'Hernoemen, sorteren en verwijderen doe je in de Instellingen van de '
        + 'groep.',
    },
    pt: {
      title: 'Guarde os seus filtros',
      body: 'O vosso grupo sorteia sempre da mesma forma? Configurem a sessão uma '
        + 'vez — etiquetas, filtros, quantidade e quem joga — e toquem em «Guardar '
        + 'filtro». Os filtros guardados aparecem em Início como começo rápido, '
        + 'para todo o grupo, e abrem «Iniciar sessão» com tudo já configurado. '
        + 'Mudem o nome, ordenem e excluam-nos nas Configurações do grupo.',
    },
    fi: {
      title: 'Tallenna suodattimet',
      body: 'Arpooko porukkanne aina samalla tavalla? Määritä sessio kerran — '
        + 'tunnisteet, suodattimet, määrä ja ketkä pelaavat — ja napauta '
        + '”Tallenna suodatin”. Tallennetut suodattimet näkyvät Aloitus-näkymässä '
        + 'pikavalintoina koko porukalle ja avaavat ”Aloita sessio” -näkymän '
        + 'valmiiksi säädettynä. Nimeä, järjestä ja poista niitä porukan '
        + 'Asetuksissa.',
    },
    ko: {
      title: '필터 저장',
      body: '모임이 늘 같은 방식으로 뽑나요? 태그, 필터, 개수, 함께하는 사람까지 세션을 한 번 설정하고 '
        + '„필터 저장"을 누르세요. 저장된 필터는 모임의 모든 사람에게 시작 화면의 빠른 시작으로 '
        + '보이고, 모든 설정이 된 채로 „세션 시작"을 엽니다. 이름 바꾸기, 순서 변경, 삭제는 모임 '
        + '설정에서 할 수 있어요.',
    },
  },
  /*
   * #1202, the flip. Clears the bar although it is not a new feature in the
   * usual sense: every account wakes up in a different look, and the one thing
   * a reader needs to find is how to get the old one back. So the entry says
   * that before anything else, and says plainly what went (the rounds' palettes
   * and worlds) and what replaced it (the colour marker).
   */
  {
    revision: '2026-09-25',
    kind: 'new',
    de: {
      title: 'Der Tisch — ein neues Aussehen, und Klassisch bleibt',
      body: 'Spielwirbel trägt jetzt „Der Tisch": dunkler Filz, Messing und '
        + 'Papierkarten, als läge alles auf dem Spieltisch. Alles liegt weiter an '
        + 'derselben Stelle — Regal, Chronik, Pokale, Session wirbeln. Wer lieber '
        + 'beim bisherigen Aussehen bleibt, wählt „Klassisch": beim ersten Öffnen '
        + 'oder jederzeit im Konto. Das Design gilt für dich, nicht für die Runde. '
        + 'Die Farbschemata und Welten der Runden gibt es dafür nicht mehr — jede '
        + 'Runde trägt stattdessen einen Farbmarker, den alle in der Runde sehen, '
        + 'jede und jeder im eigenen Design.',
    },
    en: {
      title: 'The Table — a new look, and Classic stays',
      body: 'Spielwirbel now wears „The Table": dark felt, brass and paper cards, '
        + 'as if everything lay on the games table. Everything is still where it '
        + 'was — Shelf, History, Trophies, Start session. If you would rather keep '
        + 'the old look, choose „Classic": when you first open the app, or any time '
        + 'in your account. The design is yours, not the round\'s. In return, '
        + 'rounds no longer have their own colour schemes and worlds — each round '
        + 'carries a colour marker instead, which everyone in it sees, each in '
        + 'their own design.',
    },
    es: {
      title: 'La mesa: un aspecto nuevo, y Clásico se queda',
      body: 'Spielwirbel viste ahora «La mesa»: fieltro oscuro, latón y tarjetas '
        + 'de papel, como si todo estuviera sobre la mesa de juego. Todo sigue en '
        + 'su sitio: Estantería, Historial, Trofeos, Sortear sesión. Si prefieres '
        + 'el aspecto de siempre, elige «Clásico» al abrir la app por primera vez '
        + 'o cuando quieras en tu cuenta. El diseño es tuyo, no del grupo. A '
        + 'cambio, los grupos ya no tienen esquemas de color ni mundos propios: '
        + 'cada grupo lleva un marcador de color que todos ven, cada cual en su '
        + 'propio diseño.',
    },
    fr: {
      title: 'La table — un nouveau look, et Classique reste',
      body: 'Spielwirbel porte désormais « La table » : feutre sombre, laiton et '
        + 'cartes de papier, comme si tout était posé sur la table de jeu. Tout '
        + 'reste à sa place — Étagère, Historique, Trophées, Démarrer une session. '
        + 'Si tu préfères l\'aspect d\'avant, choisis « Classique » à la première '
        + 'ouverture ou quand tu veux dans ton compte. Le design est le tien, pas '
        + 'celui du groupe. En contrepartie, les groupes n\'ont plus leurs propres '
        + 'palettes ni leurs mondes : chaque groupe porte un marqueur de couleur '
        + 'que tout le monde voit, chacun dans son propre design.',
    },
    it: {
      title: 'Il tavolo: un aspetto nuovo, e Classico resta',
      body: 'Spielwirbel ora veste «Il tavolo»: feltro scuro, ottone e carte di '
        + 'carta, come se tutto fosse sul tavolo da gioco. Tutto è ancora al suo '
        + 'posto: Scaffale, Cronologia, Trofei, Avvia una sessione. Se preferisci '
        + 'l\'aspetto di prima, scegli «Classico» alla prima apertura o quando vuoi '
        + 'nel tuo account. Il design è tuo, non del gruppo. In cambio i gruppi '
        + 'non hanno più schemi di colore e mondi propri: ogni gruppo porta un '
        + 'marcatore di colore che tutti vedono, ciascuno nel proprio design.',
    },
    nl: {
      title: 'De tafel — een nieuw uiterlijk, en Klassiek blijft',
      body: 'Spielwirbel draagt nu „De tafel": donker vilt, messing en papieren '
        + 'kaarten, alsof alles op de speltafel ligt. Alles staat nog op dezelfde '
        + 'plek — Kast, Geschiedenis, Trofeeën, Sessie starten. Blijf je liever bij '
        + 'het oude uiterlijk, kies dan „Klassiek": bij de eerste keer openen of '
        + 'wanneer je wilt in je account. Het ontwerp is van jou, niet van de '
        + 'groep. Daarvoor hebben groepen geen eigen kleurenschema\'s en werelden '
        + 'meer — elke groep draagt in plaats daarvan een kleurmarkering die '
        + 'iedereen ziet, ieder in het eigen ontwerp.',
    },
    pt: {
      title: 'A mesa — um visual novo, e o Clássico continua',
      body: 'O Spielwirbel agora veste «A mesa»: feltro escuro, latão e cartões '
        + 'de papel, como se tudo estivesse sobre a mesa de jogo. Tudo continua no '
        + 'mesmo lugar: Estante, Histórico, Troféus, Iniciar sessão. Se preferir o '
        + 'visual de antes, escolha «Clássico» ao abrir o app pela primeira vez ou '
        + 'quando quiser na sua conta. O design é seu, não do grupo. Em troca, os '
        + 'grupos deixam de ter esquemas de cores e mundos próprios: cada grupo '
        + 'leva um marcador de cor que todos veem, cada um no seu próprio design.',
    },
    fi: {
      title: 'Pöytä — uusi ilme, ja Klassinen jää',
      body: 'Spielwirbelin ilme on nyt ”Pöytä”: tumma huopa, messinki ja '
        + 'paperikortit, kuin kaikki olisi pelipöydällä. Kaikki on yhä samassa '
        + 'paikassa — Hylly, Historia, Palkinnot, Aloita sessio. Jos pidät '
        + 'vanhasta ilmeestä, valitse ”Klassinen”, kun avaat sovelluksen '
        + 'ensimmäisen kerran, tai milloin tahansa tililläsi. Ulkoasu on sinun, ei '
        + 'porukan. Porukoilla ei sen vuoksi ole enää omia värimaailmoja eikä '
        + 'maailmoja — jokaisella porukalla on sen sijaan värimerkki, jonka kaikki '
        + 'näkevät, kukin omassa ulkoasussaan.',
    },
    ko: {
      title: '테이블 — 새로운 모습, 클래식도 그대로',
      body: '이제 Spielwirbel은 „테이블" 디자인을 입습니다. 어두운 펠트, 황동, 종이 카드로 모든 것이 '
        + '게임 테이블 위에 놓인 것처럼 보입니다. 선반, 기록, 트로피, 세션 시작은 모두 그 자리에 '
        + '있습니다. 이전 모습이 더 좋다면 처음 열 때나 언제든 계정에서 „클래식"을 고르세요. 디자인은 '
        + '모임이 아니라 나에게 적용됩니다. 대신 모임마다 따로 있던 색 구성과 월드는 없어지고, 각 '
        + '모임에는 모두가 각자의 디자인으로 보는 색상 마커가 붙습니다.',
    },
  },
  /*
   * #1147. A capability that did not exist: a player in three rounds had three
   * unconnected Rückblicke and no answer to „wie war mein Jahr?". Own profile
   * only, so the entry says so.
   */
  {
    revision: '2026-09-24',
    kind: 'new',
    de: {
      title: 'Dein Rückblick — dein Monat, dein Jahr, über alle Runden',
      body: 'Auf deinem eigenen Profil findest du jetzt „Dein Rückblick": Wähle '
        + 'einen Monat oder ein Jahr und sieh, wie viele Sessions du gespielt hast, '
        + 'welches Spiel am häufigsten auf dem Tisch lag, welches du am besten '
        + 'bewertet hast und was du zum ersten Mal ausprobiert hast — über alle '
        + 'deine Runden zusammen. Nur du siehst ihn, und mit „Teilen" wird daraus '
        + 'ein Bild für den Gruppenchat.',
    },
    en: {
      title: 'Your recap — your month, your year, across all rounds',
      body: 'Your own profile now has „Your recap": pick a month or a year and see '
        + 'how many sessions you played, which game hit the table most, which one '
        + 'you rated highest and what you tried for the first time — across all of '
        + 'your rounds together. Only you can see it, and „Share" turns it into a '
        + 'picture for the group chat.',
    },
    es: {
      title: 'Tu resumen: tu mes, tu año, en todos tus grupos',
      body: 'Tu propio perfil tiene ahora «Tu resumen»: elige un mes o un año y mira '
        + 'cuántas sesiones jugaste, qué juego salió más a la mesa, cuál valoraste '
        + 'mejor y qué probaste por primera vez, sumando todos tus grupos. Solo tú '
        + 'puedes verlo, y «Compartir» lo convierte en una imagen para el chat del grupo.',
    },
    fr: {
      title: 'Ton bilan — ton mois, ton année, dans tous tes groupes',
      body: 'Ton propre profil propose désormais « Ton bilan » : choisis un mois ou '
        + 'une année et vois combien de sessions tu as jouées, quel jeu est le plus '
        + 'souvent sorti, lequel tu as le mieux noté et ce que tu as découvert — '
        + 'tous tes groupes réunis. Toi seul·e le vois, et « Partager » en fait une '
        + 'image pour le chat du groupe.',
    },
    it: {
      title: 'Il tuo riepilogo: il tuo mese, il tuo anno, in tutti i gruppi',
      body: 'Il tuo profilo ha ora «Il tuo riepilogo»: scegli un mese o un anno e '
        + 'guarda quante sessioni hai giocato, quale gioco è finito più spesso sul '
        + 'tavolo, quale hai votato meglio e cosa hai provato per la prima volta, '
        + 'sommando tutti i tuoi gruppi. Lo vedi solo tu, e «Condividi» lo '
        + 'trasforma in un’immagine per la chat del gruppo.',
    },
    nl: {
      title: 'Jouw terugblik — jouw maand, jouw jaar, over al je groepen',
      body: 'Je eigen profiel heeft nu „Jouw terugblik": kies een maand of een jaar '
        + 'en zie hoeveel sessies je speelde, welk spel het vaakst op tafel lag, '
        + 'welk je het hoogst beoordeelde en wat je voor het eerst speelde — over '
        + 'al je groepen samen. Alleen jij ziet hem, en met „Delen" wordt het een '
        + 'afbeelding voor de groepschat.',
    },
    pt: {
      title: 'Seu resumo — seu mês, seu ano, em todos os grupos',
      body: 'Seu próprio perfil agora tem «Seu resumo»: escolha um mês ou um ano e '
        + 'veja quantas sessões você jogou, qual jogo foi mais vezes para a mesa, '
        + 'qual você avaliou melhor e o que jogou pela primeira vez, somando todos '
        + 'os seus grupos. Só você vê, e «Compartilhar» transforma tudo numa imagem '
        + 'para o chat do grupo.',
    },
    fi: {
      title: 'Sinun katsauksesi — kuukautesi ja vuotesi kaikissa ryhmissä',
      body: 'Omassa profiilissasi on nyt ”Sinun katsauksesi”: valitse kuukausi tai '
        + 'vuosi ja näe, montako sessiota pelasit, mikä peli oli useimmin pöydässä, '
        + 'minkä arvioit parhaaksi ja mitä kokeilit ensimmäistä kertaa — kaikki '
        + 'ryhmäsi yhteensä. Vain sinä näet sen, ja ”Jaa” tekee siitä kuvan '
        + 'ryhmän chattiin.',
    },
    ko: {
      title: '나의 돌아보기 — 모든 그룹에서의 나의 한 달, 나의 한 해',
      body: '이제 내 프로필에 „나의 돌아보기"가 있어요. 한 달이나 한 해를 고르면 '
        + '모든 그룹을 합쳐서 세션을 몇 번 했는지, 어떤 게임을 가장 많이 했는지, '
        + '내가 가장 높게 평가한 게임과 처음 해 본 게임을 볼 수 있어요. 나만 볼 수 '
        + '있고, „공유"를 누르면 단체 채팅방에 보낼 이미지가 만들어져요.',
    },
  },
  /*
   * Clears the bar on the SECOND half rather than the first. The previews are a
   * restructure of a screen that already existed — worth describing, not worth a
   * dot on its own. The full-screen rating card is the capability: a shared phone
   * going round the table now shows one game and one question, with nothing on it
   * that leaves the vote, which is a thing the card could not do before.
   */
  {
    revision: '2026-09-22',
    kind: 'improved',
    de: {
      title: 'Die Abstimmung läuft jetzt bildschirmfüllend — und der Start-Tab zeigt, was in der Runde steckt',
      body: 'Während des Wertens füllt die Karte den ganzen Bildschirm: keine '
        + 'obere Leiste, keine Navigation, nur das Spiel und die Frage. Das Gerät '
        + 'kann so ohne Sorge weitergegeben werden — der Pfeil oben links bleibt '
        + 'der Weg zurück. Der Start-Tab einer Runde zeigt außerdem neu eine '
        + 'Vorschau auf Regal, Pokale und Chronik: ein paar Cover mit Anzahl, die '
        + 'oberen drei der Ruhmeshalle, und wie viele Sessions es gab. Darunter '
        + 'liegen unter „Nicht im Regal" Aussortiert, Durchgespielt, Wunschliste '
        + 'und Könnte euch gefallen beieinander.',
    },
    en: {
      title: 'Voting now fills the screen — and the Start tab shows what is in the round',
      body: 'While you are rating, the card fills the whole screen: no top bar, no '
        + 'navigation, just the game and the question. That makes a shared device '
        + 'safe to hand on — the arrow in the top left is still the way back. A '
        + "round's Start tab also previews Regal, Pokale and Chronik now: a few "
        + 'covers with the count, the top three of the standings, and how many '
        + 'sessions there have been. Below that, „Nicht im Regal" gathers '
        + 'Aussortiert, Durchgespielt, Wunschliste and Könnte euch gefallen in one '
        + 'place.',
    },
    es: {
      title: 'La votación ocupa ahora toda la pantalla, y la pestaña Inicio muestra lo que hay en el grupo',
      body: 'Mientras valoras, la tarjeta ocupa toda la pantalla: sin barra '
        + 'superior y sin navegación, solo el juego y la pregunta. Así el móvil '
        + 'compartido se puede pasar sin miedo; la flecha de arriba a la izquierda '
        + 'sigue siendo la salida. La pestaña Inicio de un grupo muestra además '
        + 'una vista previa de Regal, Pokale y Chronik: unas portadas con el '
        + 'número, los tres primeros de la clasificación y cuántas '
        + 'sesiones ha habido. Debajo, «Nicht im Regal» reúne Aussortiert, '
        + 'Durchgespielt, Wunschliste y Könnte euch gefallen.',
    },
    fr: {
      title: "Le vote occupe maintenant tout l'écran, et l'onglet Accueil montre ce qu'il y a dans le groupe",
      body: "Pendant que vous notez, la carte occupe tout l'écran : pas de barre "
        + "du haut, pas de navigation, juste le jeu et la question. Le téléphone "
        + "partagé se passe ainsi sans crainte ; la flèche en haut à gauche reste "
        + "la sortie. L'onglet Accueil d'un groupe présente aussi un aperçu de "
        + "Regal, Pokale et Chronik : quelques jaquettes avec le nombre, les trois "
        + "premiers du classement, et le nombre de sessions. En dessous, "
        + "« Nicht im Regal » rassemble Aussortiert, Durchgespielt, Wunschliste et "
        + "Könnte euch gefallen.",
    },
    it: {
      title: 'La votazione ora occupa tutto lo schermo, e la scheda Inizio mostra cosa c\'è nel gruppo',
      body: 'Mentre valuti, la carta occupa tutto lo schermo: nessuna barra in '
        + 'alto, nessuna navigazione, solo il gioco e la domanda. Così il telefono '
        + 'condiviso si passa senza timori; la freccia in alto a sinistra resta la '
        + 'via d\'uscita. La scheda Inizio di un gruppo mostra inoltre un\'anteprima '
        + 'di Regal, Pokale e Chronik: alcune copertine con il numero, i primi tre '
        + 'della classifica e quante sessioni ci sono state. Sotto, «Nicht im '
        + 'Regal» raccoglie Aussortiert, Durchgespielt, Wunschliste e Könnte euch '
        + 'gefallen.',
    },
    nl: {
      title: 'Stemmen vult nu het hele scherm, en het tabblad Start laat zien wat er in de groep zit',
      body: 'Terwijl je waardeert, vult de kaart het hele scherm: geen bovenbalk, '
        + 'geen navigatie, alleen het spel en de vraag. Zo kan een gedeelde '
        + 'telefoon zonder zorgen worden doorgegeven; de pijl linksboven blijft de '
        + 'weg terug. Het tabblad Start van een groep laat daarnaast een voorbeeld '
        + 'zien van Regal, Pokale en Chronik: een paar covers met het aantal, de '
        + 'top drie van de ranglijst, en hoeveel sessies er zijn geweest. '
        + 'Daaronder brengt „Nicht im Regal" Aussortiert, Durchgespielt, '
        + 'Wunschliste en Könnte euch gefallen samen.',
    },
    pt: {
      title: 'A votação ocupa agora todo o ecrã, e o separador Início mostra o que há no grupo',
      body: 'Enquanto avalias, o cartão ocupa todo o ecrã: sem barra superior e '
        + 'sem navegação, apenas o jogo e a pergunta. Assim o telemóvel partilhado '
        + 'passa de mão em mão sem receios; a seta em cima à esquerda continua a '
        + 'ser a saída. O separador Início de um grupo mostra também uma '
        + 'pré-visualização de Regal, Pokale e Chronik: algumas capas com o '
        + 'número, os três primeiros da classificação e quantas sessões '
        + 'houve. Abaixo, «Nicht im Regal» reúne Aussortiert, Durchgespielt, '
        + 'Wunschliste e Könnte euch gefallen.',
    },
    fi: {
      title: 'Äänestys täyttää nyt koko ruudun, ja Aloitus-välilehti näyttää mitä porukassa on',
      body: 'Kun arvioit, kortti täyttää koko ruudun: ei yläpalkkia eikä '
        + 'navigointia, vain peli ja kysymys. Yhteistä puhelinta voi näin '
        + 'kierrättää huoletta; vasemman ylänurkan nuoli on yhä tie takaisin. '
        + 'Porukan Aloitus-välilehti näyttää lisäksi esikatselun Regalista, '
        + 'Pokalesta ja Chronikista: muutama kansi ja lukumäärä, kärkisijojen '
        + 'kolme kärkeä sekä montako sessiota on ollut. Sen alla „Nicht im Regal" '
        + 'kokoaa yhteen Aussortiert, Durchgespielt, Wunschliste ja Könnte euch '
        + 'gefallen.',
    },
    ko: {
      title: '투표 화면이 전체 화면으로 바뀌고, 시작 탭에서 라운드 전체를 미리 볼 수 있습니다',
      body: '평가하는 동안 카드가 화면 전체를 채웁니다. 상단 바도 내비게이션도 없이 '
        + '게임과 질문만 남으므로, 함께 쓰는 기기를 마음 놓고 건넬 수 있습니다. 왼쪽 '
        + '위 화살표는 그대로 돌아가는 길입니다. 라운드의 시작 탭에서는 Regal, '
        + 'Pokale, Chronik을 미리 볼 수도 있습니다. 표지 몇 장과 개수, 순위 상위 '
        + '3명, 그리고 지금까지의 세션 수입니다. 그 아래 „Nicht im Regal"에 '
        + 'Aussortiert, Durchgespielt, Wunschliste, Könnte euch gefallen이 함께 '
        + '모여 있습니다.',
    },
  },
  /*
   * Clears the bar: an account's own record ACROSS rounds did not exist before.
   * Every round computed a per-seat record on its member page, but nobody could
   * see the sum — a player in three rounds had three unconnected records — and
   * the account's own profile could not be opened from anywhere in the UI at
   * all. So this is a screen a user genuinely could not reach, with a number
   * nothing in the app could answer.
   */
  {
    revision: '2026-09-15',
    kind: 'new',
    de: {
      title: 'Dein eigenes Profil, mit deiner Bilanz über alle Runden',
      body: 'Über „Mein Profil" im Konto-Menü kommst du jetzt auf deine eigene '
        + 'Profilseite. Dort steht deine Bilanz über alle Runden zusammen, eigene '
        + 'wie geteilte: Sessions, Siege, Siegquote, deine '
        + 'durchschnittliche Wertung, dein Lieblingsspiel und dein stärkstes '
        + 'Spiel — ein Spiel, das in mehreren Runden im Regal steht, zählt dabei '
        + 'als eins. Darunter siehst du deine eigenen Aktivitäten. Befreundete '
        + 'Konten sehen dieselbe Bilanz; im Konto lässt sich das mit einem '
        + 'Schalter abstellen. Rundennamen, Mitspielende und einzelne Sessions '
        + 'gibt das Profil nie preis.',
    },
    en: {
      title: 'Your own profile, with your record across every round',
      body: 'Your account menu now has „My profile", which opens your own profile '
        + 'page. It carries your record across all your rounds, your own and '
        + 'shared ones alike: sessions, wins, win rate, your average '
        + 'rating, your favourite game and your strongest game — a game on the '
        + 'shelf in several rounds counts once. Your own activity is listed '
        + 'below it. Accepted friends see the same record; a switch in your '
        + 'account settings turns that off. The profile never reveals round '
        + 'names, fellow players or individual sessions.',
    },
    es: {
      title: 'Tu propio perfil, con tu balance de todos los grupos',
      body: 'El menú de tu cuenta tiene ahora «Mi perfil», que abre tu propia '
        + 'página de perfil. Allí está tu balance de todos tus grupos, propios y '
        + 'compartidos: sesiones, victorias, porcentaje de victorias, '
        + 'tu valoración media, tu juego favorito y tu juego más '
        + 'fuerte: un juego que esté en la estantería de varios grupos cuenta una '
        + 'sola vez. Debajo aparece tu propia actividad. Tus amistades aceptadas '
        + 'ven el mismo balance; un interruptor en tu cuenta lo desactiva. El '
        + 'perfil nunca revela nombres de grupos, otros jugadores ni sesiones '
        + 'concretas.',
    },
    fr: {
      title: 'Ton propre profil, avec ton bilan sur tous les groupes',
      body: 'Le menu de ton compte propose désormais « Mon profil », qui ouvre ta '
        + 'propre page de profil. On y trouve ton bilan sur tous tes groupes, les '
        + 'tiens comme ceux partagés : sessions, victoires, taux de victoires, '
        + 'ta note moyenne, ton jeu préféré et ton jeu le plus '
        + 'fort — un jeu présent dans l\'étagère de plusieurs groupes ne compte '
        + 'qu\'une fois. Ton activité est listée en dessous. Tes amis acceptés '
        + 'voient le même bilan ; un interrupteur dans ton compte le désactive. Le '
        + 'profil ne révèle jamais les noms des groupes, les autres joueurs ni les '
        + 'sessions individuelles.',
    },
    it: {
      title: 'Il tuo profilo, con il tuo bilancio su tutti i gruppi',
      body: 'Nel menu del tuo account trovi ora «Il mio profilo», che apre la tua '
        + 'pagina di profilo. Lì c\'è il tuo bilancio su tutti i tuoi gruppi, i '
        + 'tuoi e quelli condivisi: sessioni, vittorie, percentuale di vittorie, '
        + 'la tua valutazione media, il tuo gioco preferito e '
        + 'il tuo gioco più forte — un gioco presente nello scaffale di più gruppi '
        + 'conta una volta sola. Sotto trovi le tue attività. Le amicizie accettate '
        + 'vedono lo stesso bilancio; un interruttore nell\'account lo disattiva. '
        + 'Il profilo non rivela mai i nomi dei gruppi, gli altri giocatori o le '
        + 'singole sessioni.',
    },
    nl: {
      title: 'Je eigen profiel, met je balans over alle groepen',
      body: 'In je accountmenu staat nu „Mijn profiel", dat je eigen profielpagina '
        + 'opent. Daar staat je balans over al je groepen, eigen en gedeelde: '
        + 'sessies, overwinningen, winstpercentage, je gemiddelde '
        + 'waardering, je lievelingsspel en je sterkste spel — een spel dat in '
        + 'meerdere groepen in de kast staat, telt één keer. Daaronder staat je '
        + 'eigen activiteit. Geaccepteerde vrienden zien dezelfde balans; een '
        + 'schakelaar in je account zet dat uit. Het profiel geeft nooit '
        + 'groepsnamen, medespelers of afzonderlijke sessies prijs.',
    },
    pt: {
      title: 'O teu próprio perfil, com o teu balanço de todos os grupos',
      body: 'O menu da tua conta passa a ter «O meu perfil», que abre a tua própria '
        + 'página de perfil. Aí está o teu balanço de todos os teus grupos, '
        + 'próprios e partilhados: sessões, vitórias, taxa de vitórias, '
        + 'de vitórias, a tua avaliação média, o teu jogo preferido e o teu jogo '
        + 'mais forte — um jogo que esteja na estante de vários grupos conta uma '
        + 'vez. Por baixo aparece a tua própria atividade. As amizades aceites '
        + 'veem o mesmo balanço; um interruptor na tua conta desliga isso. O perfil '
        + 'nunca revela nomes de grupos, outros jogadores ou sessões individuais.',
    },
    fi: {
      title: 'Oma profiilisi ja tilastosi kaikista ryhmistä',
      body: 'Tilivalikossa on nyt „Oma profiili", josta avautuu oma profiilisivusi. '
        + 'Siinä näkyy tilastosi kaikista ryhmistäsi, omista ja jaetuista: sessiot, '
        + 'voitot, voittoprosentti, keskimääräinen arviosi, '
        + 'lempipelisi ja vahvin pelisi — useamman ryhmän hyllyssä oleva peli '
        + 'lasketaan kerran. Alla näkyy oma toimintasi. Hyväksytyt kaverit näkevät '
        + 'saman tilaston; tilin asetuksista sen voi kytkeä pois. Profiili ei '
        + 'koskaan paljasta ryhmien nimiä, muita pelaajia eikä yksittäisiä '
        + 'sessioita.',
    },
    ko: {
      title: '모든 그룹을 합친 전적을 담은 내 프로필',
      body: '계정 메뉴에 „내 프로필"이 추가되어 내 프로필 페이지를 열 수 있습니다. '
        + '내 그룹과 공유받은 그룹을 모두 합친 전적이 표시됩니다: 세션, 승리, 승률, '
        + '내가 준 평균 평점, 좋아하는 게임, 가장 강한 게임 — 여러 그룹의 '
        + '책장에 있는 같은 게임은 하나로 셉니다. 그 아래에는 내 활동이 나옵니다. '
        + '수락된 친구도 같은 전적을 볼 수 있으며, 계정 설정의 스위치로 끌 수 '
        + '있습니다. 프로필은 그룹 이름, 함께 플레이한 사람, 개별 세션을 절대 '
        + '드러내지 않습니다.',
    },
  },
  /*
   * Clears the bar: until now a round's member list could only ever GROW. There
   * was no way to remove anybody, and that was not an oversight — votes are
   * stored per member id and every game's score is recomputed from them, so a
   * delete would have rewritten the group's own history. So this is a capability
   * a round genuinely did not have, reported by a user who wanted exactly it.
   */
  {
    revision: '2026-09-13',
    kind: 'new',
    de: {
      title: 'Mitglieder aus der Runde entfernen',
      body: 'Gruppen verändern sich, und bisher konnte die Mitgliederliste einer '
        + 'Runde nur wachsen. Jetzt lässt sich ein Mitglied auf seiner eigenen '
        + 'Seite aus der Runde entfernen. Die Person verschwindet aus '
        + 'der Sitzliste, den Teams, den Wertungen und den Pokalen; alles, was sie '
        + 'jemals abgestimmt und gewonnen hat, bleibt unverändert stehen, und '
        + 'kein Spiel ändert dadurch seinen Spielwirbel-Score. Wieder aufnehmen '
        + 'geht jederzeit. Wenn ein Platz nur aus Versehen entstanden ist und noch '
        + 'gar nichts daran hängt, lässt er sich stattdessen ganz löschen.',
    },
    en: {
      title: 'Removing a member from a round',
      body: 'Groups change, and until now a round\'s member list could only grow. '
        + 'You can now remove a member from the round, on their own page. '
        + 'They leave the seating list, the teams, the standings '
        + 'and the trophies; everything they ever voted on and won stays exactly '
        + 'as it was, and no game\'s Spielwirbel-Score moves because of it. '
        + 'Bringing them back is one tap. A seat that was created by mistake and '
        + 'has nothing attached to it yet can simply be deleted instead.',
    },
    es: {
      title: 'Quitar a un miembro del grupo',
      body: 'Los grupos cambian y, hasta ahora, la lista de miembros solo podía crecer. Ahora '
        + 'puedes quitar a un miembro del grupo desde su propia página. La persona desaparece de '
        + 'la lista de asientos, de los equipos, de las clasificaciones y de los Trofeos; todo lo '
        + 'que haya votado y ganado alguna vez queda exactamente como estaba, y ninguna '
        + 'Puntuación Spielwirbel cambia por ello. Volver a incorporarla es cuestión de un toque. '
        + 'Si un asiento se creó por error y todavía no tiene nada asociado, puedes borrarlo del '
        + 'todo en su lugar.',
    },
    fr: {
      title: 'Retirer un membre du groupe',
      body: 'Les groupes évoluent, et jusqu’ici la liste des membres ne pouvait que s’allonger. '
        + 'Vous pouvez désormais retirer un membre du groupe depuis sa propre page. La personne '
        + 'disparaît de la liste des places, des équipes, des classements et des Trophées ; tout '
        + 'ce qu’elle a voté et gagné reste exactement en l’état, et aucun Score Spielwirbel ne '
        + 'bouge pour autant. La réintégrer ne prend qu’une touche. Si une place a été créée par '
        + 'erreur et que rien n’y est encore rattaché, vous pouvez tout simplement la supprimer.',
    },
    it: {
      title: 'Rimuovere un membro dal gruppo',
      body: 'I gruppi cambiano e finora l’elenco dei membri poteva soltanto crescere. Ora puoi '
        + 'rimuovere un membro dal gruppo dalla sua stessa pagina. La persona sparisce '
        + 'dall’elenco dei posti, dalle squadre, dalle classifiche e dai Trofei; tutto ciò che ha '
        + 'votato e vinto resta esattamente com’era, e nessun Punteggio Spielwirbel si sposta per '
        + 'questo. Riaccoglierla è questione di un tocco. Se un posto è nato per sbaglio e non ha '
        + 'ancora nulla collegato, puoi semplicemente eliminarlo.',
    },
    nl: {
      title: 'Een lid uit de groep verwijderen',
      body: 'Groepen veranderen, en tot nu toe kon de ledenlijst alleen maar groeien. Je kunt een '
        + 'lid nu vanaf zijn eigen pagina uit de groep verwijderen. De persoon verdwijnt uit de '
        + 'zitplaatsen, de teams, de standen en de Trofeeën; alles waarop diegene ooit heeft '
        + 'gestemd en wat diegene heeft gewonnen blijft precies zoals het was, en geen enkele '
        + 'Spielwirbel-score verandert erdoor. Weer opnemen kan altijd. Is een plek per ongeluk '
        + 'ontstaan en hangt er nog niets aan, dan kun je die in plaats daarvan helemaal '
        + 'verwijderen.',
    },
    pt: {
      title: 'Remover um membro do grupo',
      body: 'Os grupos mudam e, até agora, a lista de membros só podia crescer. Agora dá para '
        + 'remover um membro do grupo na página dele. A pessoa sai da lista de lugares, das '
        + 'equipes, das classificações e dos Troféus; tudo em que ela já votou e tudo que ganhou '
        + 'continua exatamente como estava, e nenhuma Pontuação Spielwirbel muda por causa disso. '
        + 'Trazer de volta é um toque. Se um lugar foi criado por engano e ainda não tem nada '
        + 'ligado a ele, dá para simplesmente excluí-lo.',
    },
    fi: {
      title: 'Jäsenen poistaminen porukasta',
      body: 'Porukat muuttuvat, ja tähän asti jäsenlista pystyi vain kasvamaan. Nyt voit poistaa '
        + 'jäsenen porukasta hänen omalta sivultaan. Henkilö katoaa paikkalistalta, joukkueista, '
        + 'tuloksista ja Palkinnoista; kaikki, mitä hän on joskus äänestänyt ja voittanut, jää '
        + 'täsmälleen ennalleen, eivätkä minkään pelin Spielwirbel-pisteet muutu siitä. Takaisin '
        + 'ottaminen onnistuu milloin tahansa. Jos paikka on syntynyt vahingossa eikä siihen '
        + 'liity vielä mitään, sen voi sen sijaan poistaa kokonaan.',
    },
    ko: {
      title: '모임에서 멤버 내보내기',
      body: '모임은 변하기 마련인데, 지금까지 멤버 목록은 늘어나기만 했습니다. 이제 멤버 본인의 페이지에서 그 멤버를 모임에서 내보낼 수 있습니다. 해당 인물은 자리 '
        + '목록, 팀, 순위, 트로피에서 사라지지만, 그동안 투표하고 우승한 기록은 그대로 남고 어떤 게임의 Spielwirbel 점수도 이 때문에 바뀌지 않습니다. '
        + '다시 받아들이는 것도 언제든 가능합니다. 실수로 만든 자리에 아직 아무것도 연결되어 있지 않다면, 대신 완전히 삭제할 수 있습니다.',
    },
  },
  /*
   * Clears the bar: recording who owns a box is something a round could not do
   * at all, and it changes what a draw produces rather than how a screen looks —
   * the group stops being offered a game nobody at the table can bring. The bar
   * is the owned-expansions one (#653): a new fact about a game, with a new
   * consequence for the evening.
   *
   * #1002 added the „ohne Regal" exception to the SAME entry, three days on,
   * without bumping the revision — the #851 move one step further. It does widen
   * the capability rather than merely correcting a location, so this is a
   * judgement: a second dot for a refinement of the feature the reader was dotted
   * about on Monday spends the attention the terms notice needs (§11), and the
   * entry would then be incomplete either way. One sentence, no dot.
   */
  {
    revision: '2026-09-08',
    kind: 'new',
    de: {
      title: 'Wem gehört das Spiel?',
      body: 'Beim Anlegen eines Spiels, beim Übernehmen von BoardGameGeek und auf '
        + 'der Spielseite lässt sich jetzt eintragen, welchen Mitgliedern das Spiel '
        + 'gehört. Wer eingetragen ist, wird beim nächsten Spiel gleich wieder '
        + 'vorgeschlagen. Beim Auslosen zählt das dann: Spiele, deren Besitzer '
        + 'heute nicht mitspielen, kommen gar nicht erst in den Topf — und die '
        + 'Übersicht sagt, wie viele deshalb fehlen. Spiele ohne Eintrag bleiben '
        + 'wie bisher immer dabei, es ändert sich also nichts, solange niemand '
        + 'etwas einträgt. Wer mitspielt, aber seine Spiele nicht dabei hat, kann '
        + 'das beim Start der Session eintragen — dann bleiben nur seine Spiele '
        + 'heute außen vor, alles andere ändert sich nicht. Im Ergebnis steht am '
        + 'Ende, wer die Schachtel mitbringt.',
    },
    en: {
      title: 'Who owns this game?',
      body: 'When you add a game, import from BoardGameGeek, or open a game\'s '
        + 'page, you can now record which members own it — and whoever you picked '
        + 'last time is suggested again. It counts at draw time: a game whose '
        + 'owners are not playing tonight never reaches the pot, and the setup '
        + 'screen says how many are missing for that reason. Games with no owners '
        + 'recorded stay in, exactly as before, so nothing changes until somebody '
        + 'fills one in. If someone is playing but did not bring their games, you '
        + 'can say so when you set the session up — only their boxes sit out today, '
        + 'and nothing else about their seat changes. The results screen then names '
        + 'who is bringing the box.',
    },
    es: {
      title: '¿De quién es el juego?',
      body: 'Al añadir un juego, al importarlo de BoardGameGeek y en la página del juego ahora '
        + 'puedes anotar a qué miembros pertenece — y quien anotaste la última vez se vuelve a '
        + 'sugerir. Eso cuenta en el sorteo: un juego cuyos dueños no juegan hoy ni siquiera '
        + 'entra en el bombo, y la pantalla de preparación dice cuántos faltan por ese motivo. '
        + 'Los juegos sin dueño anotado siguen entrando siempre, igual que antes, así que nada '
        + 'cambia mientras nadie anote nada. Quien juegue pero no haya traído sus juegos puede '
        + 'indicarlo al empezar la Session — entonces solo sus cajas se quedan fuera hoy y nada '
        + 'más cambia en su sitio. Al final, el resultado dice quién trae la caja.',
    },
    fr: {
      title: 'À qui appartient ce jeu ?',
      body: 'En ajoutant un jeu, en le reprenant de BoardGameGeek et sur la page du jeu, vous '
        + 'pouvez maintenant noter à quels membres il appartient — et la personne notée la '
        + 'dernière fois est à nouveau proposée. Cela compte au tirage : un jeu dont les '
        + 'propriétaires ne jouent pas ce soir n’entre même pas dans le pot, et l’écran de '
        + 'préparation indique combien manquent pour cette raison. Les jeux sans propriétaire '
        + 'noté restent toujours de la partie, exactement comme avant : rien ne change tant que '
        + 'personne ne renseigne quoi que ce soit. Qui joue mais n’a pas apporté ses jeux peut le '
        + 'signaler au lancement de la Session — seules ses boîtes restent alors de côté '
        + 'aujourd’hui, et rien d’autre ne change à sa place. Le résultat indique enfin qui '
        + 'apporte la boîte.',
    },
    it: {
      title: 'Di chi è questo gioco?',
      body: 'Quando aggiungi un gioco, quando lo importi da BoardGameGeek e nella pagina del gioco '
        + 'puoi ora annotare a quali membri appartiene — e chi hai indicato l’ultima volta viene '
        + 'riproposto. Al sorteggio questo conta: un gioco i cui proprietari stasera non giocano '
        + 'non finisce nemmeno nel calderone, e la schermata di preparazione dice quanti mancano '
        + 'per questo motivo. I giochi senza proprietario indicato restano sempre in gioco, '
        + 'esattamente come prima: non cambia nulla finché nessuno annota qualcosa. Chi gioca ma '
        + 'non ha portato i suoi giochi può dirlo all’avvio della Session — solo le sue scatole '
        + 'restano fuori per oggi, e nulla altro cambia al suo posto. Alla fine il risultato dice '
        + 'chi porta la scatola.',
    },
    nl: {
      title: 'Van wie is dit spel?',
      body: 'Bij het toevoegen van een spel, bij het overnemen uit BoardGameGeek en op de '
        + 'spelpagina kun je nu vastleggen van welke leden het spel is — en wie je de vorige keer '
        + 'koos, wordt meteen weer voorgesteld. Bij het loten telt dat mee: een spel waarvan de '
        + 'eigenaars vanavond niet meespelen komt niet eens in de pot, en het startscherm zegt '
        + 'hoeveel er om die reden afvallen. Spellen zonder eigenaar blijven altijd meedoen, '
        + 'precies als voorheen, dus er verandert niets zolang niemand iets invult. Wie meespeelt '
        + 'maar zijn spellen niet bij zich heeft, kan dat bij de start van de Session aangeven — '
        + 'dan blijven alleen zijn dozen vandaag buiten beeld en verandert er verder niets aan '
        + 'zijn plek. In het resultaat staat uiteindelijk wie de doos meeneemt.',
    },
    pt: {
      title: 'De quem é este jogo?',
      body: 'Ao adicionar um jogo, ao importar do BoardGameGeek e na página do jogo agora dá para '
        + 'registrar a quais membros ele pertence — e quem você escolheu da última vez é sugerido '
        + 'de novo. Isso conta no sorteio: um jogo cujos donos não jogam hoje nem chega ao '
        + 'caldeirão, e a tela de preparação diz quantos faltam por esse motivo. Jogos sem dono '
        + 'registrado continuam entrando sempre, como antes, então nada muda enquanto ninguém '
        + 'preencher nada. Quem joga mas não trouxe seus jogos pode dizer isso ao iniciar a '
        + 'Session — aí só as caixas dessa pessoa ficam de fora hoje, e nada mais muda no lugar '
        + 'dela. No fim, o resultado diz quem leva a caixa.',
    },
    fi: {
      title: 'Kenen peli tämä on?',
      body: 'Peliä lisätessä, BoardGameGeekistä tuotaessa ja pelin omalla sivulla voit nyt merkitä, '
        + 'keiden jäsenten peli se on — ja viimeksi merkitty ehdotetaan heti uudelleen. '
        + 'Arvonnassa sillä on merkitystä: peli, jonka omistajat eivät pelaa tänään, ei päädy '
        + 'edes pataan, ja aloitusnäkymä kertoo, montako jää siksi pois. Pelit, joille ei ole '
        + 'merkitty omistajaa, ovat aina mukana kuten ennenkin, joten mikään ei muutu ennen kuin '
        + 'joku merkitsee jotain. Jos joku pelaa mutta ei ole tuonut pelejään mukanaan, sen voi '
        + 'kertoa Sessionia aloitettaessa — silloin vain hänen laatikkonsa jäävät tänään sivuun '
        + 'eikä hänen paikkaansa muutu muuten mikään. Lopuksi tuloksessa lukee, kuka tuo '
        + 'laatikon.',
    },
    ko: {
      title: '이 게임은 누구 것인가요?',
      body: '게임을 추가할 때, BoardGameGeek에서 가져올 때, 그리고 게임 페이지에서 이제 어떤 멤버의 게임인지 기록할 수 있고, 지난번에 고른 사람이 다시 '
        + '제안됩니다. 추첨할 때 이 정보가 반영됩니다. 주인이 오늘 참여하지 않는 게임은 아예 후보에 들어가지 않고, 준비 화면이 그 이유로 몇 개가 빠졌는지 알려 '
        + '줍니다. 주인을 기록하지 않은 게임은 예전처럼 항상 후보에 남으므로, 아무도 입력하지 않는 한 달라지는 것은 없습니다. 참여는 하지만 자기 게임을 가져오지 '
        + '않았다면 Session을 시작할 때 그렇게 지정할 수 있습니다. 그러면 오늘은 그 사람의 게임만 빠지고, 자리에 관한 다른 것은 그대로입니다. 결과 '
        + '화면에는 누가 게임을 가져오는지 표시됩니다.',
    },
  },
  /*
   * Clears the bar: until now a game could only ever live in ONE round, so a
   * group playing the same box in two rounds had to add it a second time by
   * hand — cover, player range, provider link and tags included. Copying is
   * something a person could not do at all before, which is the level this list
   * is for (#916).
   */
  {
    revision: '2026-09-05',
    kind: 'improved',
    de: {
      title: 'Spiele in eine andere Runde kopieren',
      body: 'Ein Spiel kann jetzt in mehreren Runden stehen. In den '
        + 'Einstellungen einer Runde könnt ihr Spiele wie bisher verschieben — '
        + 'oder neuerdings kopieren: Das Spiel bleibt hier, wo es ist, und '
        + 'landet zusätzlich im Regal der anderen Runde, mit Cover, '
        + 'Spieleranzahl, Link und Tags. Bewertungen und Sessions bleiben dabei '
        + 'bei der Runde, in der ihr gespielt habt. Spiele, die es dort schon '
        + 'gibt, sind vorher abgewählt, damit nichts doppelt im Regal steht.',
    },
    en: {
      title: 'Copy games into another round',
      body: 'A game can now sit in more than one round. In a round\'s settings '
        + 'you can move games as before — or now copy them instead: the game '
        + 'stays where it is and also lands on the other round\'s shelf, with '
        + 'its cover, player count, link and tags. Ratings and sessions stay '
        + 'with the round you actually played in. Games the other round already '
        + 'has are unticked beforehand, so nothing ends up on the shelf twice.',
    },
    es: {
      title: 'Copiar juegos a otro grupo',
      body: 'Un juego ya puede estar en varios grupos. En los Ajustes de un grupo podéis mover '
        + 'juegos como hasta ahora — o, desde ahora, copiarlos: el juego se queda donde está y '
        + 'además aparece en la Estantería del otro grupo, con portada, número de jugadores, '
        + 'enlace y etiquetas. Las valoraciones y las Sessions se quedan con el grupo en el que '
        + 'realmente jugasteis. Los juegos que el otro grupo ya tiene vienen desmarcados de '
        + 'antemano, para que nada acabe dos veces en la estantería.',
    },
    fr: {
      title: 'Copier des jeux vers un autre groupe',
      body: 'Un jeu peut désormais figurer dans plusieurs groupes. Dans les Réglages d’un groupe, '
        + 'vous pouvez déplacer des jeux comme avant — ou maintenant les copier : le jeu reste où '
        + 'il est et arrive en plus dans l’Étagère de l’autre groupe, avec sa jaquette, son '
        + 'nombre de joueurs, son lien et ses étiquettes. Les évaluations et les Sessions restent '
        + 'attachées au groupe où vous avez réellement joué. Les jeux que l’autre groupe possède '
        + 'déjà sont décochés au préalable, pour que rien ne se retrouve deux fois dans '
        + 'l’étagère.',
    },
    it: {
      title: 'Copiare giochi in un altro gruppo',
      body: 'Un gioco può ora stare in più gruppi. Nelle Impostazioni di un gruppo potete spostare '
        + 'i giochi come sempre — oppure, da ora, copiarli: il gioco resta dov’è e finisce anche '
        + 'nello Scaffale dell’altro gruppo, con copertina, numero di giocatori, link e tag. '
        + 'Valutazioni e Session restano al gruppo in cui avete davvero giocato. I giochi che '
        + 'l’altro gruppo ha già sono deselezionati in partenza, così nulla finisce due volte '
        + 'sullo scaffale.',
    },
    nl: {
      title: 'Spellen naar een andere groep kopiëren',
      body: 'Een spel kan nu in meerdere groepen staan. In de Instellingen van een groep kunnen '
        + 'jullie spellen verplaatsen zoals voorheen — of voortaan kopiëren: het spel blijft waar '
        + 'het is en komt er bovendien bij in de Kast van de andere groep, met cover, '
        + 'spelersaantal, link en tags. Beoordelingen en Sessions blijven bij de groep waarin '
        + 'jullie echt gespeeld hebben. Spellen die de andere groep al heeft, staan vooraf '
        + 'uitgevinkt, zodat er niets dubbel in de kast belandt.',
    },
    pt: {
      title: 'Copiar jogos para outro grupo',
      body: 'Um jogo agora pode estar em mais de um grupo. Nas Configurações de um grupo vocês '
        + 'podem mover jogos como antes — ou, a partir de agora, copiá-los: o jogo continua onde '
        + 'está e também vai parar na Estante do outro grupo, com capa, número de jogadores, link '
        + 'e tags. Avaliações e Sessions ficam com o grupo em que vocês realmente jogaram. Os '
        + 'jogos que o outro grupo já tem vêm desmarcados de antemão, para que nada acabe duas '
        + 'vezes na estante.',
    },
    fi: {
      title: 'Pelien kopiointi toiseen porukkaan',
      body: 'Peli voi nyt olla useammassa porukassa. Porukan Asetuksissa voitte siirtää pelejä '
        + 'kuten ennenkin — tai uutena kopioida ne: peli jää paikalleen ja päätyy lisäksi toisen '
        + 'porukan Hyllyyn kansikuvineen, pelaajamäärineen, linkkeineen ja tunnisteineen. Arviot '
        + 'ja Sessionit jäävät sille porukalle, jossa oikeasti pelasitte. Pelit, jotka toisella '
        + 'porukalla jo on, ovat valmiiksi valitsematta, jottei mikään päädy hyllyyn kahdesti.',
    },
    ko: {
      title: '다른 모임으로 게임 복사하기',
      body: '이제 한 게임이 여러 모임에 있을 수 있습니다. 모임 설정에서 예전처럼 게임을 옮길 수도 있고, 새로 추가된 복사를 쓸 수도 있습니다. 복사하면 게임은 '
        + '원래 자리에 그대로 남고 다른 모임의 선반에도 표지, 인원수, 링크, 태그와 함께 올라갑니다. 평가와 Session은 실제로 플레이한 모임에 그대로 '
        + '남습니다. 상대 모임이 이미 가지고 있는 게임은 미리 선택 해제되어 있어, 같은 게임이 선반에 두 번 올라가지 않습니다.',
    },
  },
  /*
   * A judgement call, decided WITH the operator (#893) rather than by the bar
   * alone. Strictly this is not a new capability — ratings already existed —
   * and on that reading it does not qualify. What tipped it is the failure mode
   * running the other way: the number every user has learned to read changes
   * value and name overnight on every screen at once. Unannounced, that reads
   * as the app having broken rather than improved, and the ⓘ sheet only reaches
   * somebody who already went looking for an explanation.
   *
   * Note what the body does NOT do: print the curve, or promise a formula. The
   * six values are explicitly tunable, so an entry quoting them would be wrong
   * the first time anybody retunes — and a group does not need the arithmetic.
   */
  {
    revision: '2026-09-04',
    kind: 'improved',
    de: {
      title: 'Der Spielwirbel-Score löst den Ø ab',
      body: 'Die Bewertung eines Spiels ist jetzt mehr als der Durchschnitt: '
        + 'Wenn jemand ein Spiel gar nicht spielen möchte, zählt das schwerer '
        + 'als eine gute Bewertung von jemand anderem — damit am Ende gespielt '
        + 'wird, worauf alle Lust haben. Weicht der Score vom Durchschnitt '
        + 'ab, steht daneben, warum. Ein Spiel mit erst wenigen Bewertungen '
        + 'wird dabei vorsichtiger eingeschätzt, und ein Spiel, das ihr immer '
        + 'wieder auf den Tisch legt, etwas besser.',
    },
    en: {
      title: 'The Spielwirbel score replaces the Ø',
      body: 'A game\'s rating is now more than the average: if somebody does '
        + 'not want to play a game at all, that counts for more than a good '
        + 'rating from somebody else — so that what you end up playing is '
        + 'something everybody is up for. Where the score differs from the '
        + 'average, it says why right beside it. A game with only a few '
        + 'ratings so far is judged more cautiously, and a game you keep '
        + 'putting on the table a little more favourably.',
    },
    es: {
      title: 'La Puntuación Spielwirbel sustituye a la media',
      body: 'La valoración de un juego es ahora algo más que la media: si alguien no quiere jugar a '
        + 'un juego en absoluto, eso pesa más que una buena valoración de otra persona — para que '
        + 'al final se juegue a algo que apetece a todos. Cuando la puntuación se aparta de la '
        + 'media, justo al lado dice por qué. Un juego con pocas valoraciones todavía se juzga '
        + 'con más prudencia, y un juego que ponéis sobre la mesa una y otra vez, algo mejor.',
    },
    fr: {
      title: 'Le Score Spielwirbel remplace la moyenne',
      body: 'L’évaluation d’un jeu est maintenant plus qu’une moyenne : si quelqu’un ne veut pas du '
        + 'tout jouer à un jeu, cela pèse davantage qu’une bonne note de quelqu’un d’autre — pour '
        + 'qu’au bout du compte, on joue à ce dont tout le monde a envie. Quand le score s’écarte '
        + 'de la moyenne, la raison est indiquée juste à côté. Un jeu qui n’a encore que peu '
        + 'd’évaluations est jugé avec plus de prudence, et un jeu que vous remettez sans cesse '
        + 'sur la table, un peu plus favorablement.',
    },
    it: {
      title: 'Il Punteggio Spielwirbel sostituisce la media',
      body: 'La valutazione di un gioco è ora più della media: se qualcuno non vuole proprio '
        + 'giocare a un gioco, questo pesa più di un buon voto di qualcun altro — così alla fine '
        + 'si gioca a ciò che va bene a tutti. Quando il punteggio si discosta dalla media, '
        + 'accanto c’è scritto perché. Un gioco con ancora poche valutazioni viene giudicato con '
        + 'più cautela, e un gioco che rimettete in tavola di continuo un po’ più favorevolmente.',
    },
    nl: {
      title: 'De Spielwirbel-score vervangt het gemiddelde',
      body: 'De beoordeling van een spel is nu meer dan het gemiddelde: als iemand een spel '
        + 'helemaal niet wil spelen, weegt dat zwaarder dan een goede beoordeling van iemand '
        + 'anders — zodat er uiteindelijk iets gespeeld wordt waar iedereen zin in heeft. Wijkt '
        + 'de score af van het gemiddelde, dan staat er direct naast waarom. Een spel met nog '
        + 'maar weinig beoordelingen wordt voorzichtiger ingeschat, en een spel dat jullie steeds '
        + 'weer op tafel leggen iets gunstiger.',
    },
    pt: {
      title: 'A Pontuação Spielwirbel substitui a média',
      body: 'A avaliação de um jogo agora é mais do que a média: se alguém não quer jogar um jogo '
        + 'de jeito nenhum, isso pesa mais do que uma boa nota de outra pessoa — para que no fim '
        + 'se jogue algo que agrada a todos. Quando a pontuação se afasta da média, logo ao lado '
        + 'está o motivo. Um jogo com poucas avaliações ainda é julgado com mais cautela, e um '
        + 'jogo que vocês colocam na mesa sempre de novo, um pouco melhor.',
    },
    fi: {
      title: 'Spielwirbel-pisteet korvaavat keskiarvon',
      body: 'Pelin arvio on nyt enemmän kuin keskiarvo: jos joku ei halua pelata peliä lainkaan, se '
        + 'painaa enemmän kuin jonkun toisen hyvä arvio — jotta lopulta pelataan sitä, mikä '
        + 'kaikkia kiinnostaa. Kun pisteet poikkeavat keskiarvosta, vieressä lukee miksi. Peliä, '
        + 'jolla on vasta vähän arvioita, arvioidaan varovaisemmin, ja peliä, jonka nostatte '
        + 'kerta toisensa jälkeen pöydälle, hieman suopeammin.',
    },
    ko: {
      title: '평균을 대신하는 Spielwirbel 점수',
      body: '게임의 평가는 이제 단순한 평균 이상입니다. 누군가 어떤 게임을 전혀 하고 싶어 하지 않는다면, 그 의사가 다른 사람의 좋은 평가보다 더 크게 반영됩니다. '
        + '결국 모두가 내키는 게임을 하게 하기 위해서입니다. 점수가 평균과 다를 때는 그 이유가 바로 옆에 표시됩니다. 아직 평가가 적은 게임은 더 조심스럽게 '
        + '평가되고, 계속 꺼내 드는 게임은 조금 더 후하게 평가됩니다.',
    },
  },
  /*
   * Clears the bar: an account could not be recognised by anything but two
   * letters, so a picture is something a person could not do at all before —
   * the level of passkeys (#418) or the BGG import (#481).
   *
   * The EXIF line is deliberately in the body rather than left to the privacy
   * policy. It is the one thing about this feature a reader might otherwise
   * worry about, and it is a promise we keep — a phone photo's coordinates are
   * never stored (lib/avatar.js).
   */
  {
    revision: '2026-08-30',
    kind: 'new',
    de: {
      title: 'Profilbild für dein Konto',
      body: 'Du kannst deinem Konto jetzt im Kontobereich ein Bild geben. Es '
        + 'erscheint überall dort, wo dein Konto ohnehin auftaucht: auf deiner '
        + 'Profilseite, im Freundeskreis und auf deinem Sitzplatz in einer Runde. '
        + 'Ohne Bild bleibt alles wie bisher bei den Initialen. Die Metadaten der '
        + 'Bilddatei — auch der GPS-Ort von Handyfotos — entfernen wir beim '
        + 'Hochladen, und du kannst das Bild jederzeit wieder löschen.',
    },
    en: {
      title: 'A profile picture for your account',
      body: 'You can now give your account a picture from the Konto screen. It '
        + 'shows up wherever your account already does: your profile page, the '
        + 'Freundeskreis, and your seat in a round. Without one, everything stays '
        + 'as it was with your initials. We strip the image file\'s metadata on '
        + 'upload — including the GPS location phone photos carry — and you can '
        + 'remove the picture again at any time.',
    },
    es: {
      title: 'Una foto de perfil para tu cuenta',
      body: 'Ahora puedes darle una imagen a tu cuenta desde la pantalla Cuenta. Aparece allí donde '
        + 'ya aparece tu cuenta: en tu página de Perfil, en Amigos y en tu sitio dentro de un '
        + 'grupo. Sin imagen, todo sigue como antes con tus iniciales. Al subirla eliminamos los '
        + 'metadatos del archivo — también la ubicación GPS que llevan las fotos hechas con un '
        + 'dispositivo — y puedes borrar la imagen cuando quieras.',
    },
    fr: {
      title: 'Une photo de profil pour votre compte',
      body: 'Vous pouvez désormais donner une image à votre compte depuis l’écran Compte. Elle '
        + 'apparaît partout où votre compte apparaît déjà : sur votre page de Profil, dans les '
        + 'Amis et à votre place dans un groupe. Sans image, tout reste comme avant avec vos '
        + 'initiales. À l’envoi, nous retirons les métadonnées du fichier — y compris la position '
        + 'GPS que portent les photos prises avec un appareil — et vous pouvez supprimer l’image '
        + 'à tout moment.',
    },
    it: {
      title: 'Un’immagine del profilo per il tuo account',
      body: 'Ora puoi dare un’immagine al tuo account dalla schermata Account. Compare ovunque '
        + 'compaia già il tuo account: sulla tua pagina Profilo, negli Amici e al tuo posto in un '
        + 'gruppo. Senza immagine resta tutto come prima, con le tue iniziali. Al caricamento '
        + 'rimuoviamo i metadati del file — anche la posizione GPS che le foto scattate con un '
        + 'dispositivo portano con sé — e puoi cancellare l’immagine in qualsiasi momento.',
    },
    nl: {
      title: 'Een profielfoto voor je account',
      body: 'Je kunt je account nu vanuit het scherm Account een afbeelding geven. Die verschijnt '
        + 'overal waar je account toch al te zien is: op je Profiel-pagina, bij Vrienden en op je '
        + 'plek in een groep. Zonder afbeelding blijft alles zoals het was, met je initialen. Bij '
        + 'het uploaden verwijderen we de metadata van het bestand — ook de GPS-locatie die '
        + 'foto’s van een apparaat bij zich dragen — en je kunt de afbeelding altijd weer '
        + 'verwijderen.',
    },
    pt: {
      title: 'Uma foto de perfil para a sua conta',
      body: 'Agora você pode dar uma imagem à sua conta na tela Conta. Ela aparece em todo lugar '
        + 'onde a sua conta já aparece: na sua página de Perfil, nos Amigos e no seu lugar dentro '
        + 'de um grupo. Sem imagem, tudo continua como antes, com as suas iniciais. No envio '
        + 'removemos os metadados do arquivo — inclusive a localização GPS que fotos tiradas com '
        + 'um dispositivo carregam — e você pode apagar a imagem quando quiser.',
    },
    fi: {
      title: 'Profiilikuva tilillesi',
      body: 'Voit nyt antaa tilillesi kuvan Tili-näkymässä. Se näkyy kaikkialla, missä tilisi '
        + 'muutenkin näkyy: Profiili-sivullasi, Kavereissa ja omalla paikallasi porukassa. Ilman '
        + 'kuvaa kaikki pysyy ennallaan nimikirjaimillasi. Poistamme lähetettäessä kuvatiedoston '
        + 'metatiedot — myös laitteella otettujen kuvien GPS-sijainnin — ja voit poistaa kuvan '
        + 'milloin tahansa.',
    },
    ko: {
      title: '계정에 프로필 사진 넣기',
      body: '이제 계정 화면에서 계정에 사진을 넣을 수 있습니다. 사진은 계정이 이미 표시되는 모든 곳에 나타납니다. 프로필 페이지, 친구 목록, 그리고 모임에서의 '
        + '자리입니다. 사진이 없으면 지금처럼 이니셜이 그대로 표시됩니다. 업로드할 때 이미지 파일의 메타데이터는 제거하며, 기기로 찍은 사진에 담긴 GPS 위치도 '
        + '함께 지웁니다. 사진은 언제든 다시 삭제할 수 있습니다.',
    },
  },
  /*
   * Clears the capability bar: the app could only ever answer "all time", so
   * „unser Juli" and „unser 2026" were questions it had no way to ask — and the
   * shareable image is a thing the group could not produce at all.
   * Says what the reader can do and where; that it is derived on demand and
   * drawn client-side is the repo's business, not theirs.
   *
   * The LOCATION was corrected by #851 (Pokale -> Chronik) without bumping the
   * revision: the entry was a day old and the capability did not change, so
   * re-lighting the dot would spend attention the terms notice needs.
   */
  {
    revision: '2026-08-29',
    kind: 'new',
    de: {
      title: 'Rückblick auf einen Monat oder ein Jahr',
      body: 'In der Chronik könnt ihr jetzt einen einzelnen Monat oder ein ganzes '
        + 'Jahr auswählen: wie viele Sessions es waren, welche Spiele auf dem Tisch '
        + 'lagen, was am häufigsten gespielt und am besten bewertet wurde, und was in '
        + 'der Zeit ins Regal kam oder es verlassen hat. „Teilen" macht daraus ein '
        + 'Bild für den Gruppenchat.',
    },
    en: {
      title: 'Look back on a month or a year',
      body: 'In the Chronik you can now pick a single month or a whole year: how '
        + 'many sessions there were, which games made it to the table, what you played '
        + 'most and rated best, and what joined or left the shelf in that time. '
        + '"Share" turns it into an image for the group chat.',
    },
    es: {
      title: 'Un repaso a un mes o a un año',
      body: 'En el Historial ahora podéis elegir un solo mes o un año entero: cuántas Sessions '
        + 'hubo, qué juegos llegaron a la mesa, a qué se jugó más y qué se valoró mejor, y qué '
        + 'entró en la estantería o salió de ella en ese tiempo. «Compartir» lo convierte en una '
        + 'imagen para el chat del grupo.',
    },
    fr: {
      title: 'Un bilan sur un mois ou une année',
      body: 'Dans l’Historique, vous pouvez maintenant choisir un mois précis ou une année entière '
        + ': combien de Sessions il y a eu, quels jeux sont arrivés sur la table, à quoi vous '
        + 'avez le plus joué et ce que vous avez le mieux noté, et ce qui a rejoint l’étagère ou '
        + 'l’a quittée pendant cette période. « Partager » en fait une image pour la discussion '
        + 'de groupe.',
    },
    it: {
      title: 'Uno sguardo indietro su un mese o un anno',
      body: 'Nella Cronologia potete ora scegliere un singolo mese o un anno intero: quante Session '
        + 'ci sono state, quali giochi sono finiti in tavola, a cosa avete giocato di più e cosa '
        + 'avete valutato meglio, e cosa è arrivato sullo scaffale o l’ha lasciato in quel '
        + 'periodo. «Condividi» ne fa un’immagine per la chat di gruppo.',
    },
    nl: {
      title: 'Terugblik op een maand of een jaar',
      body: 'In de Geschiedenis kunnen jullie nu één maand of een heel jaar kiezen: hoeveel '
        + 'Sessions het waren, welke spellen op tafel lagen, wat het vaakst gespeeld en het best '
        + 'beoordeeld werd, en wat er in die tijd in de kast kwam of eruit verdween. „Delen" '
        + 'maakt er een afbeelding van voor de groepschat.',
    },
    pt: {
      title: 'Uma retrospectiva de um mês ou de um ano',
      body: 'No Histórico vocês agora podem escolher um único mês ou um ano inteiro: quantas '
        + 'Sessions houve, quais jogos foram parar na mesa, o que foi mais jogado e melhor '
        + 'avaliado, e o que entrou na estante ou saiu dela nesse período. «Compartilhar» '
        + 'transforma isso em uma imagem para o chat do grupo.',
    },
    fi: {
      title: 'Katsaus kuukauteen tai vuoteen',
      body: 'Historiassa voitte nyt valita yksittäisen kuukauden tai kokonaisen vuoden: montako '
        + 'Sessionia oli, mitkä pelit päätyivät pöydälle, mitä pelattiin eniten ja mikä sai '
        + 'parhaat arviot, ja mitä sinä aikana tuli hyllyyn tai lähti siitä. ”Jaa” tekee siitä '
        + 'kuvan ryhmächattiin.',
    },
    ko: {
      title: '한 달 또는 한 해 돌아보기',
      body: '기록 화면에서 이제 특정 한 달이나 한 해 전체를 고를 수 있습니다. Session이 몇 번이었는지, 어떤 게임이 테이블에 올랐는지, 무엇을 가장 많이 '
        + '플레이하고 무엇이 가장 좋은 평가를 받았는지, 그리고 그 기간에 무엇이 선반에 들어오고 나갔는지를 보여 줍니다. ‘공유’를 누르면 단체 대화방에 보낼 '
        + '이미지로 만들어 줍니다.',
    },
  },
  /*
   * The bulk-REMOVE counterpart of the BGG collection import, which is the
   * capability test this clears: the shelf could be filled in one action and
   * emptied only one game (and two steps) at a time. Says what the reader can
   * do and where; the endpoint, the co-owner gate and the retire-first
   * semantics are all the repo's business, not theirs.
   */
  {
    revision: '2026-08-28',
    kind: 'improved',
    de: {
      title: 'Regal in einem Rutsch aufräumen',
      body: 'Im Regal gibt es jetzt „Auswählen": Spiele antippen, Suche und Filter '
        + 'dabei ganz normal weiterbenutzen — „Alle auswählen" nimmt genau das, was '
        + 'gerade zu sehen ist. Die Auswahl könnt ihr in einem Schritt aussortieren '
        + 'oder endgültig löschen. Auf „Aussortiert", „Durchgespielt" und der '
        + 'Wunschliste geht dasselbe zum Löschen.',
    },
    en: {
      title: 'Tidy the whole shelf at once',
      body: 'The Regal now has a "Select" mode: tap the games you mean while the '
        + 'search and filters keep working — "Select all" takes exactly what is on '
        + 'screen. Retire the selection, or delete it for good, in one step. The '
        + 'retired, completed and wishlist screens offer the same for deleting.',
    },
    es: {
      title: 'Ordenar toda la estantería de una vez',
      body: 'La Estantería tiene ahora un modo «Seleccionar»: toca los juegos que quieras mientras '
        + 'la búsqueda y los filtros siguen funcionando — «Seleccionar todo» coge exactamente lo '
        + 'que hay en pantalla. Podéis retirar la selección o borrarla definitivamente en un solo '
        + 'paso. En Retirados, Completados y la Lista de deseos se puede hacer lo mismo para '
        + 'borrar.',
    },
    fr: {
      title: 'Ranger toute l’étagère d’un coup',
      body: 'L’Étagère dispose maintenant d’un mode « Sélectionner » : touchez les jeux voulus, la '
        + 'recherche et les filtres continuant de fonctionner — « Tout sélectionner » prend '
        + 'exactement ce qui est à l’écran. Vous pouvez retirer la sélection ou la supprimer '
        + 'définitivement en une seule étape. Les écrans Retirés, Terminés et la Liste d’envies '
        + 'proposent la même chose pour la suppression.',
    },
    it: {
      title: 'Riordinare tutto lo scaffale in una volta',
      body: 'Lo Scaffale ha ora una modalità «Seleziona»: tocca i giochi che ti interessano mentre '
        + 'ricerca e filtri continuano a funzionare — «Seleziona tutto» prende esattamente ciò '
        + 'che è a schermo. La selezione può essere ritirata o eliminata definitivamente in un '
        + 'solo passaggio. Le schermate Ritirati, Completati e la Lista dei desideri offrono lo '
        + 'stesso per l’eliminazione.',
    },
    nl: {
      title: 'De hele kast in één keer opruimen',
      body: 'De Kast heeft nu een modus „Selecteren": tik de spellen aan die je bedoelt terwijl '
        + 'zoeken en filters gewoon blijven werken — „Alles selecteren" pakt precies wat er in '
        + 'beeld staat. De selectie kunnen jullie in één stap opzijleggen of definitief '
        + 'verwijderen. Op Opzijgelegd, Uitgespeeld en de Verlanglijst kan hetzelfde om te '
        + 'verwijderen.',
    },
    pt: {
      title: 'Arrumar a estante inteira de uma vez',
      body: 'A Estante agora tem um modo «Selecionar»: toque nos jogos que você quer enquanto a '
        + 'busca e os filtros continuam funcionando — «Selecionar tudo» pega exatamente o que '
        + 'está na tela. Vocês podem aposentar a seleção ou apagá-la de vez em um único passo. Em '
        + 'Aposentados, Concluídos e na Lista de desejos dá para fazer o mesmo para apagar.',
    },
    fi: {
      title: 'Koko hyllyn siivous kerralla',
      body: 'Hyllyssä on nyt ”Valitse”-tila: napauta haluamiasi pelejä samalla kun haku ja '
        + 'suodattimet toimivat normaalisti — ”Valitse kaikki” ottaa täsmälleen sen, mikä on '
        + 'näkyvissä. Valinnan voi karsia tai poistaa lopullisesti yhdellä kertaa. Karsitut, '
        + 'Läpipelatut ja Toivelista tarjoavat saman poistamista varten.',
    },
    ko: {
      title: '선반을 한 번에 정리하기',
      body: '선반에 ‘선택’ 모드가 생겼습니다. 검색과 필터를 평소처럼 쓰면서 원하는 게임을 탭하면 되고, ‘전체 선택’은 지금 화면에 보이는 것만 정확히 집습니다. '
        + '선택한 게임은 한 번에 정리하거나 완전히 삭제할 수 있습니다. 정리한 게임, 완료한 게임, 위시리스트에서도 삭제를 같은 방식으로 할 수 있습니다.',
    },
  },
  /*
   * A genuinely new capability — a group that could not use the session flow at
   * all can now use it — which is the bar .claude/rules/keep-readme-current.md
   * sets. Says what the reader can DO, deliberately not how the split is chosen:
   * the objective is the interesting half for the repo and the wrong half here.
   */
  {
    revision: '2026-08-21',
    kind: 'new',
    de: {
      title: 'Mehrere Tische in einer Session',
      body: 'Zu viele für ein Spiel? Setzt beim Auslosen einen Haken bei „Mehrere '
        + 'Tische". Es wird einmal gemeinsam abgestimmt, danach schlägt euch die App '
        + 'fertige Aufteilungen auf zwei, drei oder mehr Tische vor — mit Spiel und '
        + 'Sitzordnung. Ihr könnt alles noch von Hand umstellen und seht dabei sofort, '
        + 'wie zufrieden jeder Tisch ist.',
    },
    en: {
      title: 'Several tables in one session',
      body: 'Too many of you for one game? Tick "Multiple tables" when you draw. '
        + 'Everyone votes once together, and the app then proposes ready-made splits '
        + 'across two, three or more tables — game and seating included. You can move '
        + 'anyone by hand and see straight away how happy each table is.',
    },
    es: {
      title: 'Varias mesas en una Session',
      body: '¿Sois demasiados para un solo juego? Marcad «Varias mesas» al sortear. Se vota una vez '
        + 'entre todos y, a continuación, la aplicación os propone repartos ya hechos para dos, '
        + 'tres o más mesas — con juego y distribución de sitios incluidos. Podéis cambiarlo todo '
        + 'a mano y ver al instante lo contenta que está cada mesa.',
    },
    fr: {
      title: 'Plusieurs tables dans une Session',
      body: 'Trop nombreux pour un seul jeu ? Cochez « Plusieurs tables » au tirage. Tout le monde '
        + 'vote une seule fois ensemble, puis l’application vous propose des répartitions toutes '
        + 'prêtes sur deux, trois tables ou plus — jeu et placement compris. Vous pouvez tout '
        + 'réorganiser à la main et voir aussitôt à quel point chaque table est satisfaite.',
    },
    it: {
      title: 'Più tavoli in una Session',
      body: 'Troppi per un solo gioco? Spuntate «Più tavoli» al sorteggio. Si vota una volta sola '
        + 'tutti insieme, poi l’app vi propone suddivisioni già pronte su due, tre o più tavoli — '
        + 'gioco e disposizione dei posti compresi. Potete riorganizzare tutto a mano e vedere '
        + 'subito quanto è soddisfatto ogni tavolo.',
    },
    nl: {
      title: 'Meerdere tafels in één Session',
      body: 'Met te veel voor één spel? Zet bij het loten een vinkje bij „Meerdere tafels". Er '
        + 'wordt één keer samen gestemd, waarna de app jullie kant-en-klare verdelingen over '
        + 'twee, drie of meer tafels voorstelt — inclusief spel en zitindeling. Jullie kunnen '
        + 'alles nog met de hand omzetten en zien meteen hoe tevreden elke tafel is.',
    },
    pt: {
      title: 'Várias mesas em uma Session',
      body: 'Gente demais para um jogo só? Marquem «Várias mesas» no sorteio. Vota-se uma vez só, '
        + 'todos juntos, e depois o app propõe divisões prontas em duas, três ou mais mesas — com '
        + 'jogo e disposição dos lugares. Vocês podem remanejar tudo à mão e ver na hora o quanto '
        + 'cada mesa está satisfeita.',
    },
    fi: {
      title: 'Useampi pöytä yhdessä Sessionissa',
      body: 'Liikaa väkeä yhteen peliin? Rastittakaa arvonnassa ”Useampi pöytä”. Äänestetään kerran '
        + 'yhdessä, minkä jälkeen sovellus ehdottaa valmiita jakoja kahdelle, kolmelle tai '
        + 'useammalle pöydälle — peli ja istumajärjestys mukaan lukien. Voitte järjestää kaiken '
        + 'vielä käsin ja näette heti, kuinka tyytyväinen kukin pöytä on.',
    },
    ko: {
      title: '한 Session에 여러 테이블',
      body: '한 게임을 하기에 인원이 너무 많나요? 추첨할 때 ‘여러 테이블’에 체크하세요. 투표는 다 함께 한 번만 하고, 그다음 앱이 두 개, 세 개 또는 그 '
        + '이상의 테이블로 나눈 안을 게임과 자리 배치까지 포함해 제안합니다. 직접 손으로 옮길 수도 있고, 각 테이블의 만족도가 바로 표시됩니다.',
    },
  },
  /*
   * Deliberately says what the reader can DO and where, not how it works. The
   * mechanism (a local BGG corpus, weighted arithmetic, no AI) is the interesting
   * half for the repo and the wrong half here — and naming the scoring would
   * promise a precision a heuristic should not claim.
   */
  {
    revision: '2026-08-14',
    kind: 'new',
    de: {
      title: 'Das könnte euch auch gefallen',
      body: 'Im Regal einer Runde steht jetzt unten „Könnte euch gefallen": Spiele, '
        + 'die ihr noch nicht habt, ausgewählt nach eurem eigenen Regal und euren '
        + 'Wertungen. Jeder Vorschlag sagt dazu, warum er dabei ist — und ein Tipp '
        + 'setzt ihn auf die Wunschliste.',
    },
    en: {
      title: 'You might also like',
      body: 'A round\'s shelf now has a "You might also like" link at the bottom: '
        + 'games you do not own yet, picked from your own shelf and your own '
        + 'ratings. Every suggestion says why it is there — and one tap puts it on '
        + 'your wish list.',
    },
    es: {
      title: 'También os puede gustar',
      body: 'La Estantería de un grupo tiene ahora abajo un enlace «También os puede gustar»: '
        + 'juegos que todavía no tenéis, elegidos a partir de vuestra propia estantería y de '
        + 'vuestras propias valoraciones. Cada sugerencia dice por qué está ahí — y con un toque '
        + 'pasa a la Lista de deseos.',
    },
    fr: {
      title: 'Ça pourrait vous plaire',
      body: 'L’Étagère d’un groupe propose maintenant en bas un lien « Ça pourrait vous plaire » : '
        + 'des jeux que vous n’avez pas encore, choisis à partir de votre propre étagère et de '
        + 'vos propres évaluations. Chaque suggestion dit pourquoi elle est là — et une touche la '
        + 'place sur la Liste d’envies.',
    },
    it: {
      title: 'Potrebbe piacervi anche',
      body: 'Lo Scaffale di un gruppo ha ora in fondo un collegamento «Potrebbe piacervi anche»: '
        + 'giochi che non avete ancora, scelti in base al vostro scaffale e alle vostre '
        + 'valutazioni. Ogni proposta dice perché è lì — e un tocco la mette nella Lista dei '
        + 'desideri.',
    },
    nl: {
      title: 'Misschien ook iets voor jullie',
      body: 'De Kast van een groep heeft onderaan nu een link „Misschien ook iets voor jullie": '
        + 'spellen die jullie nog niet hebben, gekozen op basis van jullie eigen kast en jullie '
        + 'eigen beoordelingen. Elke suggestie zegt erbij waarom hij er staat — en één tik zet '
        + 'hem op de Verlanglijst.',
    },
    pt: {
      title: 'Você também pode gostar',
      body: 'A Estante de um grupo agora tem lá embaixo um link «Você também pode gostar»: jogos '
        + 'que vocês ainda não têm, escolhidos a partir da estante de vocês e das avaliações de '
        + 'vocês. Cada sugestão diz por que está ali — e um toque a coloca na Lista de desejos.',
    },
    fi: {
      title: 'Saattaisit pitää myös näistä',
      body: 'Porukan Hyllyn alalaidassa on nyt linkki ”Saattaisit pitää myös näistä”: pelejä, joita '
        + 'teillä ei vielä ole, valittuna oman hyllynne ja omien arvioidenne perusteella. '
        + 'Jokainen ehdotus kertoo, miksi se on mukana — ja yhdellä napautuksella se siirtyy '
        + 'Toivelistalle.',
    },
    ko: {
      title: '이런 게임도 좋아할 거예요',
      body: '모임의 선반 아래쪽에 ‘이런 게임도 좋아할 거예요’ 링크가 생겼습니다. 아직 가지고 있지 않은 게임을, 여러분의 선반과 여러분이 매긴 평가를 바탕으로 골라 '
        + '줍니다. 제안마다 왜 골랐는지 이유가 함께 표시되고, 한 번 탭하면 위시리스트에 담깁니다.',
    },
  },
  /*
   * Deliberately GENERAL about what is on the page. Each figure appears only
   * once it clears its own minimum, so which of them a reader actually sees
   * depends on how big the instance is that day — naming them ("see the most
   * played game of the year!") would promise cards that may not be there.
   */
  {
    revision: '2026-08-13',
    kind: 'new',
    de: {
      title: 'Entdecken',
      body: 'Unter „Entdecken" steht jetzt, was auf Spielwirbel insgesamt los ist: '
        + 'wie viel hier zusammengekommen ist und welche Spiele gerade besonders '
        + 'oft im Regal stehen, gespielt oder gut bewertet werden. Du findest die '
        + 'Seite in diesem Menü.',
    },
    en: {
      title: 'Discover',
      body: 'A new "Discover" page shows what is going on across Spielwirbel as a '
        + 'whole: how much has come together here, and which games are currently '
        + 'on especially many shelves, played especially often, or rated '
        + 'especially well. You will find it in this menu.',
    },
    es: {
      title: 'Descubrir',
      body: 'En «Descubrir» ahora se ve qué ocurre en Spielwirbel en su conjunto: cuánto se ha '
        + 'reunido aquí y qué juegos están ahora mismo en especialmente muchas estanterías, se '
        + 'juegan especialmente a menudo o reciben especialmente buenas valoraciones. Encontrarás '
        + 'la página en este menú.',
    },
    fr: {
      title: 'Découvrir',
      body: 'Sous « Découvrir », on voit maintenant ce qui se passe sur Spielwirbel dans son '
        + 'ensemble : tout ce qui s’est rassemblé ici, et quels jeux sont en ce moment dans '
        + 'particulièrement beaucoup d’étagères, particulièrement souvent joués ou '
        + 'particulièrement bien notés. Vous trouverez la page dans ce menu.',
    },
    it: {
      title: 'Esplora',
      body: 'In «Esplora» si vede ora cosa succede su Spielwirbel nel suo insieme: quanto si è '
        + 'raccolto qui e quali giochi stanno in questo momento in particolarmente tanti '
        + 'scaffali, vengono giocati particolarmente spesso o valutati particolarmente bene. '
        + 'Trovi la pagina in questo menu.',
    },
    nl: {
      title: 'Ontdekken',
      body: 'Onder „Ontdekken" staat nu wat er op Spielwirbel als geheel gebeurt: hoeveel er hier '
        + 'is samengekomen en welke spellen op dit moment in bijzonder veel kasten staan, '
        + 'bijzonder vaak gespeeld of bijzonder goed beoordeeld worden. Je vindt de pagina in dit '
        + 'menu.',
    },
    pt: {
      title: 'Descobrir',
      body: 'Em «Descobrir» agora dá para ver o que acontece no Spielwirbel como um todo: quanto já '
        + 'se juntou por aqui e quais jogos estão neste momento em especialmente muitas estantes, '
        + 'são jogados com especial frequência ou recebem avaliações especialmente boas. Você '
        + 'encontra a página neste menu.',
    },
    fi: {
      title: 'Löydä',
      body: 'Kohdassa ”Löydä” näkyy nyt, mitä Spielwirbelissä kaiken kaikkiaan tapahtuu: kuinka '
        + 'paljon tänne on kertynyt ja mitkä pelit ovat juuri nyt erityisen monessa hyllyssä, '
        + 'erityisen usein pelattuja tai erityisen hyvin arvioituja. Löydät sivun tästä '
        + 'valikosta.',
    },
    ko: {
      title: '둘러보기',
      body: '‘둘러보기’에서 이제 Spielwirbel 전체의 흐름을 볼 수 있습니다. 여기에 얼마나 많은 것이 모였는지, 그리고 요즘 어떤 게임이 특히 많은 선반에 '
        + '놓여 있고, 특히 자주 플레이되며, 특히 좋은 평가를 받는지 보여 줍니다. 이 메뉴에서 페이지를 찾을 수 있습니다.',
    },
  },
  // { revision: '2026-08-20', kind: 'new', // or 'improved' / 'fixed'
  //   de: { title: 'Kurzer Titel', body: 'Was man jetzt tun kann.' },
  //   en: { title: 'Short title', body: 'What you can do now.' },
  //   es: { … }, fr: { … }, it: { … }, nl: { … }, pt: { … }, fi: { … }, ko: { … } },
  // — every code in public/js/locales.js, or the suite goes red naming the
  //   entry and the locale it is missing.
];

// The newest entry's revision, or null while the list is empty. Null is what
// makes "no dot, ever" the empty-list behaviour without a second flag.
function newsRevision() { return NEWS.length ? NEWS[0].revision : null; }

// The reader's own language, falling back to English and then German rather
// than straight to German like TERMS_CHANGELOG does. That document is legal
// text where the German version is authoritative; this is product copy, so
// English is the more useful fallback.
//
// Since #1087 that chain is DEFENSIVE, not the normal path: every entry carries
// every shipped locale, enforced by test/news-locales.test.js. It survives for
// an unknown code reaching this function at all — a stale `localStorage` value,
// a locale being removed from locales.js — where returning `undefined` would
// throw in the caller rather than render something.
function newsText(entry, lang) {
  return entry[lang] || entry.en || entry.de;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { NEWS, newsRevision, newsText };
}
