'use strict';

/*
 * The FAQ page (issue #489): GET /faq, server-rendered, DE authoritative + EN
 * courtesy translation in one script-free document.
 *
 * WHY SERVER-RENDERED rather than a standalone public/faq.html like the contact
 * page. Several answers are true of the operator's instance and false of a
 * self-hosted one — whether donations exist, whether accounts are even on,
 * whether there is a privacy policy to point at. A static page can only hide
 * those with JS from /api/config, and neither a crawler nor a JS-off visitor
 * ever runs it, so the untrue sentence still ships in the bytes
 * (.claude/rules/hidden-attribute-vs-display-rule.md is the same failure one
 * level down). Resolving the gates here means the answer an instance cannot
 * honestly give is simply never rendered.
 *
 * The page itself is deliberately NOT gated the way lib/routes/legal.js is: an
 * FAQ carries no legal precondition, so it answers 200 everywhere and just
 * drops what does not apply.
 *
 * Content rules — keep them when editing:
 *  - Every answer must be checkable against this repo. No aspiration, no
 *    roadmap, nothing the code does not do today: "an export is planned" is a
 *    promise that goes stale on its own the moment the plan changes.
 *  - **No links into the issue tracker** (operator decision, 2026-08-02). An
 *    open issue was tried here as a way to say "this is being discussed" without
 *    promising an outcome — the distinction holds, but this is a page for people
 *    deciding whether to sign up, not a development surface, and sending them to
 *    GitHub is the wrong impression. The repository link in the maintenance
 *    answer is deliberately different: there the source being public IS the
 *    answer to the question asked.
 *  - Donations may say what the money and time go INTO; they may not say the
 *    service depends on them, imply anything is withheld without them, or
 *    suggest a donor gets something. The "unlocks nothing" sentence leads that
 *    answer on purpose and must stay ahead of the rest (#173 — donations are
 *    unconditional).
 *  - Never restate a processing description from the privacy policy in
 *    different words; LINK it (.claude/rules/keep-legal-docs-current.md). A
 *    second, drifting copy of a data-protection statement is the failure that
 *    rule exists for, and test/faq.test.js pins the markers.
 *  - German is the REFERENCE text every translation is made from, and each
 *    non-German page says so in one line at the top. It is not "authoritative
 *    like the legal pages" — that phrase went with the two halves in #1088: the
 *    FAQ carries no legal weight, and borrowing the framing overstated what this
 *    page is.
 *  - EVERY shipped locale, one language per page. An explicit `?lang=` wins,
 *    then Accept-Language, then German; lib/routes/faq.js resolves it. A tenth
 *    language cannot ship without its answers — test/faq.test.js derives the
 *    required set from public/js/locales.js.
 *  - An answer that stops being true is a bug in the same PR that made it
 *    untrue (.claude/rules/keep-readme-current.md lists this page).
 *
 * Nothing here interpolates env or user input — every string is a literal in
 * this file — so unlike lib/legal.js there is no escaping to get wrong.
 */

const legal = require('./legal');
// The face design (#1198), stamped onto <html> so the page picks its token
// copy on the server — see the face block in renderFaq's <style>.
const { FACE_DESIGN } = require('../public/js/designs');
const accounts = require('./accounts');
// The shipped locale set and its native labels, from the one file that owns them
// (.claude/rules/locale-set-is-data.md). lib/routes/contact.js already requires
// out of public/js/ for the same reason.
const { SUPPORTED_LOCALES, LOCALE_LABELS, localeTag } = require('../public/js/locales');

// The public repository, also offered by the landing page's "source" chip as
// LANDING_REPO_URL (public/js/views-landing.js). The SPA file is a shared-global
// script with no module.exports, so it cannot be required from here the way
// .claude/rules/shared-constants-across-the-stack.md prefers; test/faq.test.js
// asserts the two spellings agree instead — that parity check is the licence
// for this copy, the TAG_ICONS shape.
const REPO_URL = 'https://github.com/ChulioZ/spielwirbel';

function donationsConfigured() { return (process.env.DONATE_URL || '').trim() !== ''; }

/*
 * The questions, in reading order. `gate` (optional) decides whether this
 * instance can answer honestly at all; without one the answer holds everywhere.
 *
 * Note what each gate really stands for:
 *  - `legal.legalConfigured()` — the instance publishes an Impressum and a
 *    privacy policy, so the routes those answers link actually serve something.
 *    Both the "your data" answers hang off it, because both of them work by
 *    pointing at the policy rather than paraphrasing it.
 *  - `accounts.accountsEnabled()` — the account model exists. With accounts off
 *    (a self-hosted, password-only instance) nobody has an account at all, so
 *    the question does not arise rather than having a different answer.
 */
const QUESTIONS = [
  {
    id: 'accounts',
    gate: () => accounts.accountsEnabled(),
    de: {
      q: 'Brauchen alle ein Konto?',
      a: `<p>Nein. Ein Konto braucht nur, wer eine Runde anlegt. Alle anderen
sind <strong>reine Namensplätze</strong> in dieser Runde — ohne E-Mail-Adresse,
ohne Passwort, ohne Registrierung.</p>
<p>Eine Runde kann komplett von einem Gerät laufen: Ihr gebt es beim Abstimmen
herum, statt dass sich alle einzeln anmelden.</p>
<p>Ihr könnt aber auch mischen — pro Person, ohne vorher etwas einzustellen: Wer
ein Konto hat, verknüpft seinen Platz damit und stimmt vom eigenen Gerät ab.</p>
<p>Und ganz ohne Konto geht es auch: Zu jeder laufenden Abstimmung lässt
sich ein <strong>Link</strong> teilen. Wer ihn bekommt, wählt seinen Namen aus
der Teilnehmerliste und bewertet vom eigenen Gerät — ohne Registrierung. Der Link
zeigt nur die ausgelosten Spiele und wer schon abgestimmt hat, nie die Stimmen
selbst, und er gilt nur bis zum Ende dieser Abstimmung.</p>`,
    },
    en: {
      q: 'Does everyone need an account?',
      a: `<p>No. Only the person who sets up a round needs one. Everybody else is
a <strong>name-only seat</strong> in that round — no e-mail address, no
password, no sign-up.</p>
<p>A round can run entirely from one device: you pass it around to vote, rather
than everyone signing in separately.</p>
<p>You can also mix, per person and with nothing to set up beforehand: anyone who
does have an account links their seat to it and votes from their own device.</p>
<p>It also works with no account at all: any running vote can be shared
as a <strong>link</strong>. Whoever receives it picks their name from the
participant list and rates the games on their own device — no sign-up. The link
shows only the drawn games and who has voted so far, never the votes themselves,
and it works only until that vote ends.</p>`,
    },
    es: {
      q: '¿Todo el mundo necesita una cuenta?',
      a: `<p>No. Solo la necesita quien crea un grupo. Todos los demás son
<strong>plazas con nombre</strong> en ese grupo: sin dirección de correo, sin
contraseña, sin registro.</p>
<p>Un grupo puede funcionar entero desde un solo dispositivo: os lo vais pasando
para votar en vez de que cada cual inicie sesión por su cuenta.</p>
<p>También podéis mezclarlo, persona a persona y sin configurar nada antes: quien
sí tenga cuenta vincula su plaza a ella y vota desde su propio dispositivo.</p>
<p>Y funciona incluso sin ninguna cuenta: de cualquier votación en curso se puede
compartir un <strong>enlace</strong>. Quien lo recibe elige su nombre en la lista
de participantes y valora los juegos en su dispositivo, sin registrarse. El
enlace solo muestra los juegos sorteados y quién ha votado ya, nunca los votos en
sí, y sirve únicamente hasta que termina esa votación.</p>`,
    },
    fr: {
      q: 'Faut-il un compte pour tout le monde ?',
      a: `<p>Non. Seule la personne qui crée un groupe en a besoin. Tous les autres
sont de simples <strong>places nominatives</strong> dans ce groupe : pas
d’adresse e-mail, pas de mot de passe, pas d’inscription.</p>
<p>Un groupe peut fonctionner entièrement depuis un seul appareil : vous le faites
circuler pour voter, au lieu que chacun se connecte séparément.</p>
<p>Vous pouvez aussi mélanger, personne par personne et sans rien régler à
l’avance : qui possède un compte y rattache sa place et vote depuis son propre
appareil.</p>
<p>Et cela marche même sans aucun compte : tout vote en cours peut être partagé
sous forme de <strong>lien</strong>. Celui qui le reçoit choisit son nom dans la
liste des participants et note les jeux depuis son appareil, sans inscription. Le
lien montre seulement les jeux tirés et qui a déjà voté, jamais les votes
eux-mêmes, et il ne vaut que jusqu’à la fin de ce vote.</p>`,
    },
    it: {
      q: 'Serve un account a tutti?',
      a: `<p>No. Serve solo a chi crea un gruppo. Tutti gli altri sono
<strong>posti con un nome</strong> in quel gruppo: niente indirizzo e-mail,
niente password, nessuna registrazione.</p>
<p>Un gruppo può funzionare interamente da un solo dispositivo: ve lo passate per
votare, invece che accedere ognuno per conto proprio.</p>
<p>Potete anche mescolare le due cose, persona per persona e senza impostare
nulla in anticipo: chi ha un account collega il proprio posto e vota dal proprio
dispositivo.</p>
<p>E funziona anche senza alcun account: di ogni votazione in corso si può
condividere un <strong>link</strong>. Chi lo riceve sceglie il proprio nome
nell’elenco dei partecipanti e valuta i giochi dal proprio dispositivo, senza
registrarsi. Il link mostra solo i giochi sorteggiati e chi ha già votato, mai i
voti stessi, e vale soltanto fino alla fine di quella votazione.</p>`,
    },
    nl: {
      q: 'Heeft iedereen een account nodig?',
      a: `<p>Nee. Alleen wie een groep aanmaakt heeft er een nodig. Alle anderen
zijn <strong>plekken met alleen een naam</strong> in die groep: geen e-mailadres,
geen wachtwoord, geen registratie.</p>
<p>Een groep kan helemaal vanaf één apparaat draaien: je geeft het door om te
stemmen, in plaats van dat iedereen apart inlogt.</p>
<p>Je kunt het ook mengen, per persoon en zonder van tevoren iets in te stellen:
wie wél een account heeft, koppelt zijn plek eraan en stemt vanaf zijn eigen
apparaat.</p>
<p>En het werkt ook helemaal zonder account: van elke lopende stemming kun je een
<strong>link</strong> delen. Wie die krijgt, kiest zijn naam uit de deelnemerslijst
en beoordeelt de spellen op zijn eigen apparaat, zonder registratie. De link laat
alleen de gelote spellen zien en wie er al gestemd heeft, nooit de stemmen zelf,
en hij geldt alleen tot het einde van die stemming.</p>`,
    },
    pt: {
      q: 'Todo mundo precisa de uma conta?',
      a: `<p>Não. Só quem cria um grupo precisa. Todos os outros são
<strong>lugares só com o nome</strong> nesse grupo: sem endereço de e-mail, sem
senha, sem cadastro.</p>
<p>Um grupo pode funcionar inteiro a partir de um único dispositivo: vocês o
passam adiante para votar, em vez de cada um entrar separadamente.</p>
<p>Também dá para misturar, pessoa a pessoa e sem configurar nada antes: quem tem
conta vincula o seu lugar a ela e vota do próprio dispositivo.</p>
<p>E funciona até sem conta nenhuma: de qualquer votação em andamento dá para
compartilhar um <strong>link</strong>. Quem recebe escolhe o seu nome na lista de
participantes e avalia os jogos no próprio dispositivo, sem cadastro. O link
mostra apenas os jogos sorteados e quem já votou, nunca os votos em si, e vale
somente até o fim daquela votação.</p>`,
    },
    fi: {
      q: 'Tarvitseeko jokaisen tili?',
      a: `<p>Ei. Tili tarvitaan vain porukan perustamiseen. Kaikki muut ovat
<strong>pelkkiä nimipaikkoja</strong> siinä porukassa: ei sähköpostiosoitetta, ei
salasanaa, ei rekisteröitymistä.</p>
<p>Porukka voi pyöriä kokonaan yhdeltä laitteelta: kierrätätte sitä äänestäessä
sen sijaan, että jokainen kirjautuisi erikseen.</p>
<p>Voitte myös sekoittaa nämä, henkilö kerrallaan eikä mitään tarvitse asettaa
etukäteen: jolla on tili, liittää paikkansa siihen ja äänestää omalta
laitteeltaan.</p>
<p>Ja se toimii myös aivan ilman tiliä: jokaisesta käynnissä olevasta
äänestyksestä voi jakaa <strong>linkin</strong>. Sen saaja valitsee nimensä
osallistujalistalta ja arvioi pelit omalta laitteeltaan ilman rekisteröitymistä.
Linkki näyttää vain arvotut pelit ja sen, kuka on jo äänestänyt, ei koskaan itse
ääniä, ja se on voimassa vain kyseisen äänestyksen loppuun.</p>`,
    },
    ko: {
      q: '모두 계정이 필요한가요?',
      a: `<p>아니요. 계정은 모임을 만드는 사람에게만 필요합니다. 나머지는 모두 그 모임 안의
<strong>이름뿐인 자리</strong>입니다. 이메일 주소도, 비밀번호도, 가입도 필요 없습니다.</p>
<p>모임 전체를 기기 하나로 운영할 수 있습니다. 각자 따로 로그인하는 대신 투표할 때 기기를
돌려 가며 쓰면 됩니다.</p>
<p>섞어서 쓸 수도 있고, 미리 설정할 것도 없습니다. 계정이 있는 사람은 자기 자리를 계정에
연결하고 자기 기기에서 투표하면 됩니다.</p>
<p>계정이 전혀 없어도 됩니다. 진행 중인 투표는 <strong>링크</strong>로 공유할 수 있습니다.
링크를 받은 사람은 참가자 목록에서 자기 이름을 고르고 자기 기기에서 게임을 평가합니다.
가입은 필요 없습니다. 링크에는 추첨된 게임과 누가 이미 투표했는지만 보이고 투표 내용은 결코
보이지 않으며, 그 투표가 끝날 때까지만 유효합니다.</p>`,
    },
  },
  {
    // #1202: the look became per PERSON, and every existing account woke up in
    // Der Tisch. The one thing a reader needs is the way back, so it comes first.
    // Gated like `accounts`: the chooser and the Konto picker exist only with the
    // account model; a password-only instance keeps the design on the device.
    id: 'design',
    gate: () => accounts.accountsEnabled(),
    de: {
      q: 'Kann ich das alte Aussehen zurückbekommen?',
      a: `<p>Ja. Spielwirbel trägt jetzt „Der Tisch" — dunkler Filz, Messing und
Papierkarten. Das bisherige Aussehen heißt <strong>Klassisch</strong> und bleibt
dauerhaft wählbar: beim ersten Öffnen über „Wie bisher" oder jederzeit unter
<strong>Konto → Design</strong>. Dort gibt es auch das helle <strong>Ocean</strong>.
Alles liegt in jedem Design an derselben Stelle.</p>
<p>Das Design gilt für dich, nicht für die Runde — alle in einer Runde können ein
anderes tragen. Was die Runde behält, ist ihr <strong>Farbmarker</strong>: Den
sehen alle, jede und jeder im eigenen Design. Die früheren Farbschemata und
Welten der Runden gibt es nicht mehr; eine Runde, die eines davon trug, zeigt den
passenden Farbmarker.</p>`,
    },
    en: {
      q: 'Can I get the old look back?',
      a: `<p>Yes. Spielwirbel now wears „The Table" — dark felt, brass and paper
cards. The previous look is called <strong>Classic</strong> and stays available
for good: when you first open the app, via „As before", or any time under
<strong>Account → Design</strong>. The light <strong>Ocean</strong> is there too.
Everything is in the same place in every design.</p>
<p>The design is yours, not the round's — everyone in a round can wear a
different one. What the round keeps is its <strong>colour marker</strong>, which
everyone sees, each in their own design. The rounds' former colour schemes and
worlds are gone; a round that wore one shows the matching colour marker.</p>`,
    },
    es: {
      q: '¿Puedo recuperar el aspecto de antes?',
      a: `<p>Sí. Spielwirbel viste ahora «La mesa»: fieltro oscuro, latón y tarjetas
de papel. El aspecto anterior se llama <strong>Clásico</strong> y seguirá
disponible siempre: al abrir la app por primera vez, con «Como hasta ahora», o en
cualquier momento en <strong>Cuenta → Diseño</strong>. Ahí está también el claro
<strong>Océano</strong>. En todos los diseños todo está en el mismo sitio.</p>
<p>El diseño es tuyo, no del grupo: cada persona de un grupo puede llevar uno
distinto. Lo que conserva el grupo es su <strong>marcador de color</strong>, que
todos ven, cada cual en su propio diseño. Los antiguos esquemas de color y mundos
de los grupos ya no existen; un grupo que llevaba uno muestra el marcador de color
correspondiente.</p>`,
    },
    fr: {
      q: 'Puis-je retrouver l’ancien aspect ?',
      a: `<p>Oui. Spielwirbel porte désormais « La table » : feutre sombre, laiton et
cartes de papier. L’aspect précédent s’appelle <strong>Classique</strong> et reste
disponible pour de bon : à la première ouverture, via « Comme avant », ou à tout
moment dans <strong>Compte → Design</strong>. Le clair <strong>Océan</strong> s’y
trouve aussi. Tout est au même endroit dans chaque design.</p>
<p>Le design est le tien, pas celui du groupe : chacun dans un groupe peut en
porter un différent. Ce que le groupe garde, c’est son <strong>marqueur de
couleur</strong>, que tout le monde voit, chacun dans son propre design. Les
anciennes palettes et les mondes des groupes n’existent plus ; un groupe qui en
portait un affiche le marqueur de couleur correspondant.</p>`,
    },
    it: {
      q: 'Posso riavere l’aspetto di prima?',
      a: `<p>Sì. Spielwirbel ora veste «Il tavolo»: feltro scuro, ottone e carte di
carta. L’aspetto precedente si chiama <strong>Classico</strong> e resta sempre
disponibile: alla prima apertura, con «Come prima», o in qualsiasi momento in
<strong>Account → Design</strong>. Lì c’è anche il chiaro <strong>Oceano</strong>.
In ogni design tutto è allo stesso posto.</p>
<p>Il design è tuo, non del gruppo: ognuno in un gruppo può averne uno diverso.
Ciò che il gruppo conserva è il suo <strong>marcatore di colore</strong>, che
tutti vedono, ciascuno nel proprio design. I vecchi schemi di colore e i mondi dei
gruppi non esistono più; un gruppo che ne aveva uno mostra il marcatore di colore
corrispondente.</p>`,
    },
    nl: {
      q: 'Kan ik het oude uiterlijk terugkrijgen?',
      a: `<p>Ja. Spielwirbel draagt nu „De tafel": donker vilt, messing en papieren
kaarten. Het vorige uiterlijk heet <strong>Klassiek</strong> en blijft altijd
beschikbaar: bij de eerste keer openen via „Zoals voorheen", of wanneer je wilt
onder <strong>Account → Ontwerp</strong>. Daar staat ook het lichte
<strong>Oceaan</strong>. In elk ontwerp staat alles op dezelfde plek.</p>
<p>Het ontwerp is van jou, niet van de groep: iedereen in een groep kan een ander
dragen. Wat de groep houdt, is haar <strong>kleurmarkering</strong>, die iedereen
ziet, ieder in het eigen ontwerp. De vroegere kleurenschema's en werelden van de
groepen bestaan niet meer; een groep die er een droeg, toont de bijpassende
kleurmarkering.</p>`,
    },
    pt: {
      q: 'Posso ter o visual antigo de volta?',
      a: `<p>Sim. O Spielwirbel agora veste «A mesa»: feltro escuro, latão e cartões
de papel. O visual anterior se chama <strong>Clássico</strong> e continua
disponível para sempre: ao abrir o app pela primeira vez, com «Como antes», ou a
qualquer momento em <strong>Conta → Design</strong>. Lá também está o claro
<strong>Oceano</strong>. Em todos os designs, tudo está no mesmo lugar.</p>
<p>O design é seu, não do grupo: cada pessoa num grupo pode usar um diferente. O
que o grupo mantém é o seu <strong>marcador de cor</strong>, que todos veem, cada
um no seu próprio design. Os antigos esquemas de cores e mundos dos grupos não
existem mais; um grupo que usava um mostra o marcador de cor correspondente.</p>`,
    },
    fi: {
      q: 'Saanko vanhan ilmeen takaisin?',
      a: `<p>Kyllä. Spielwirbelin ilme on nyt ”Pöytä”: tumma huopa, messinki ja
paperikortit. Aiempi ilme on nimeltään <strong>Klassinen</strong>, ja se pysyy
valittavana pysyvästi: kun avaat sovelluksen ensimmäisen kerran, valinnalla
”Kuten ennen”, tai milloin tahansa kohdassa <strong>Tili → Ulkoasu</strong>.
Sieltä löytyy myös vaalea <strong>Valtameri</strong>. Jokaisessa ulkoasussa
kaikki on samassa paikassa.</p>
<p>Ulkoasu on sinun, ei porukan: jokainen porukassa voi käyttää eri ulkoasua.
Porukalle jää sen <strong>värimerkki</strong>, jonka kaikki näkevät, kukin omassa
ulkoasussaan. Porukoiden aiempia värimaailmoja ja maailmoja ei enää ole; porukka,
jolla sellainen oli, näyttää vastaavan värimerkin.</p>`,
    },
    ko: {
      q: '예전 모습으로 되돌릴 수 있나요?',
      a: `<p>네. 이제 Spielwirbel은 „테이블" 디자인을 입습니다. 어두운 펠트, 황동, 종이 카드입니다.
예전 모습은 <strong>클래식</strong>이라고 하며 앞으로도 계속 고를 수 있습니다. 처음 열 때
„기존 그대로"를 누르거나, 언제든 <strong>계정 → 디자인</strong>에서 바꿀 수 있습니다. 그곳에는
밝은 <strong>바다</strong>도 있습니다. 어떤 디자인이든 모든 것이 같은 자리에 있습니다.</p>
<p>디자인은 모임이 아니라 나에게 적용됩니다. 한 모임의 사람들이 각자 다른 디자인을 써도 됩니다.
모임에 남는 것은 <strong>색상 마커</strong>이며, 모두가 각자의 디자인으로 봅니다. 예전의
모임별 색 구성과 월드는 없어졌고, 그런 것을 쓰던 모임에는 그에 맞는 색상 마커가 표시됩니다.</p>`,
    },
  },
  {
    id: 'score',
    de: {
      q: 'Warum passt der Score nicht zum Durchschnitt der Bewertungen?',
      a: `<p>Weil er mehr ist als der Durchschnitt. Der
<strong>Spielwirbel-Score</strong> gewichtet jede Stimme, bevor er mittelt: Wenn
jemand ein Spiel <em>gar nicht</em> spielen möchte, zählt das schwerer als eine
gute Bewertung von jemand anderem.</p>
<p>Der Grund ist einfach: Bei zwei Spielen mit demselben Durchschnitt ist das
eine für alle in Ordnung, und beim anderen sitzt eine Person dabei, die nicht
mag. Das sind zwei sehr verschiedene Empfehlungen — der Durchschnitt allein kann
sie nicht auseinanderhalten.</p>
<p>Solange niemand schlechter als „geht so" bewertet hat, weicht der Score aus
diesem Grund nicht ab — und wenn er es tut, steht daneben, was es war, etwa
„1× gar nicht".</p>
<p>Ein zweiter Grund kommt dazu: Ein Spiel mit erst wenigen Bewertungen wird
vorsichtiger eingeschätzt. Sein Score liegt näher an der Mitte der Skala, bis
ein paar Sessions zusammengekommen sind — damit ein Spiel, das an einem einzigen
Abend drei Bestnoten bekommen hat, nicht dauerhaft über allem steht, worüber ihr
euch wirklich eine Meinung gebildet habt. Umgekehrt zählt es deutlich, wenn ihr
ein Spiel immer wieder auf den Tisch legt: Auch ohne Bewertungen bekommt es
dadurch einen Score.</p>
<p>In den Score eines Spiels gehen nur dessen eigene Bewertungen und Partien
ein — nie, wie eure anderen Spiele abgeschnitten haben. Dieselben Stimmen und
Partien ergeben deshalb in jeder Runde dieselbe Zahl.</p>`,
    },
    en: {
      q: 'Why does the score not match the average of the ratings?',
      a: `<p>Because it is more than the average. The <strong>Spielwirbel
score</strong> weighs each vote before averaging: if somebody does
<em>not at all</em> want to play a game, that counts for more than a good rating
from somebody else.</p>
<p>The reason is simple: take two games with the same average. Everybody is fine
with one of them, and at the other there is a person sitting there who would
rather not. Those are two very different recommendations, and the average alone
cannot tell them apart.</p>
<p>As long as nobody rated below „so-so", the score does not diverge for that
reason — and when it does, it says what, right beside it, for example „1× not at
all".</p>
<p>There is a second reason it can differ: a game with only a few ratings so far
is judged more cautiously. Its score sits closer to the middle of the scale
until a few sessions have added up — so a game that collected three top marks on
one single night does not permanently outrank everything you have really formed
a view on. It works the other way round too: a game you keep putting on the
table earns real credit for it, and gets a score even without ratings.</p>
<p>Only a game's own ratings and plays go into its score — never how your other
games happen to have done. The same votes and plays therefore produce the same
number in every round.</p>`,
    },
    es: {
      q: '¿Por qué la puntuación no coincide con la media de las valoraciones?',
      a: `<p>Porque es más que la media. La <strong>Puntuación Spielwirbel</strong>
pondera cada voto antes de promediar: si alguien <em>no quiere en absoluto</em>
jugar a un juego, eso pesa más que una buena valoración de otra persona.</p>
<p>El motivo es sencillo: piensa en dos juegos con la misma media. Con uno todo
el mundo está a gusto; en el otro hay alguien que preferiría no jugarlo. Son dos
recomendaciones muy distintas, y la media por sí sola no las distingue.</p>
<p>Mientras nadie haya valorado por debajo de «regular», la puntuación no se
aparta por ese motivo — y cuando lo hace, lo dice justo al lado, por ejemplo «1×
en absoluto».</p>
<p>Hay un segundo motivo por el que puede diferir: un juego con pocas
valoraciones todavía se juzga con más prudencia. Su puntuación se queda más cerca
del centro de la escala hasta que se acumulan algunas Sessions, para que un juego
que reunió tres notas máximas en una sola noche no supere para siempre a todo
aquello sobre lo que de verdad os habéis formado una opinión. También funciona al
revés: un juego que ponéis una y otra vez sobre la mesa se gana crédito real por
ello, y obtiene puntuación incluso sin valoraciones.</p>
<p>En la puntuación de un juego entran solo sus propias valoraciones y partidas,
nunca cómo les haya ido a vuestros otros juegos. Los mismos votos y las mismas
partidas dan por tanto el mismo número en cualquier grupo.</p>`,
    },
    fr: {
      q: 'Pourquoi le score ne correspond-il pas à la moyenne des évaluations ?',
      a: `<p>Parce qu’il est plus que la moyenne. Le <strong>Score Spielwirbel</strong>
pondère chaque vote avant de faire la moyenne : si quelqu’un <em>ne veut
absolument pas</em> jouer à un jeu, cela pèse davantage qu’une bonne note de
quelqu’un d’autre.</p>
<p>La raison est simple : prenez deux jeux de même moyenne. L’un convient à tout
le monde ; à l’autre, une personne présente préférerait s’abstenir. Ce sont deux
recommandations très différentes, et la moyenne seule ne les distingue pas.</p>
<p>Tant que personne n’a noté en dessous de « bof », le score ne s’écarte pas
pour cette raison — et quand il s’écarte, il dit pourquoi juste à côté, par
exemple « 1× pas du tout ».</p>
<p>Il peut différer pour une seconde raison : un jeu qui n’a encore que peu
d’évaluations est jugé avec plus de prudence. Son score reste plus près du milieu
de l’échelle jusqu’à ce que quelques Sessions se soient accumulées — pour qu’un
jeu ayant récolté trois notes maximales en une seule soirée ne dépasse pas
définitivement tout ce sur quoi vous vous êtes vraiment fait une idée. L’inverse
vaut aussi : un jeu que vous remettez sans cesse sur la table le mérite
réellement, et obtient un score même sans évaluations.</p>
<p>Seuls les évaluations et les parties du jeu lui-même entrent dans son score,
jamais la façon dont vos autres jeux s’en sont tirés. Les mêmes votes et les
mêmes parties donnent donc le même nombre dans n’importe quel groupe.</p>`,
    },
    it: {
      q: 'Perché il punteggio non corrisponde alla media delle valutazioni?',
      a: `<p>Perché è più della media. Il <strong>Punteggio Spielwirbel</strong>
pesa ogni voto prima di fare la media: se qualcuno <em>non vuole proprio</em>
giocare a un gioco, questo conta più di un buon voto di qualcun altro.</p>
<p>Il motivo è semplice: prendete due giochi con la stessa media. Con uno vanno
tutti d’accordo; all’altro c’è una persona che preferirebbe evitarlo. Sono due
raccomandazioni molto diverse, e la media da sola non le distingue.</p>
<p>Finché nessuno ha votato sotto «così così», il punteggio non se ne discosta
per questo motivo — e quando lo fa, lo dice lì accanto, per esempio «1× per
niente».</p>
<p>C’è un secondo motivo per cui può differire: un gioco con ancora poche
valutazioni viene giudicato con più cautela. Il suo punteggio resta più vicino al
centro della scala finché non si sommano alcune Session, così che un gioco che ha
raccolto tre voti massimi in una sola serata non superi per sempre tutto ciò su
cui vi siete davvero fatti un’idea. Vale anche al contrario: un gioco che
rimettete di continuo in tavola se lo guadagna davvero, e ottiene un punteggio
anche senza valutazioni.</p>
<p>Nel punteggio di un gioco entrano solo le sue valutazioni e le sue partite,
mai come sono andati gli altri vostri giochi. Gli stessi voti e le stesse partite
danno quindi lo stesso numero in qualsiasi gruppo.</p>`,
    },
    nl: {
      q: 'Waarom komt de score niet overeen met het gemiddelde van de beoordelingen?',
      a: `<p>Omdat hij meer is dan het gemiddelde. De
<strong>Spielwirbel-score</strong> weegt elke stem vóór het middelen: als iemand
een spel <em>helemaal niet</em> wil spelen, telt dat zwaarder dan een goede
beoordeling van iemand anders.</p>
<p>De reden is eenvoudig: neem twee spellen met hetzelfde gemiddelde. Met het ene
is iedereen tevreden; bij het andere zit er iemand die liever niet meedoet. Dat
zijn twee heel verschillende aanbevelingen, en het gemiddelde alleen kan ze niet
uit elkaar houden.</p>
<p>Zolang niemand lager dan „gaat wel" heeft beoordeeld, wijkt de score om die
reden niet af — en als hij afwijkt, staat er direct naast waardoor, bijvoorbeeld
„1× helemaal niet".</p>
<p>Er is een tweede reden waarom hij kan afwijken: een spel met nog maar weinig
beoordelingen wordt voorzichtiger ingeschat. De score blijft dichter bij het
midden van de schaal tot er een paar Sessions bij zijn gekomen — zodat een spel
dat op één avond drie topcijfers verzamelde niet voorgoed boven alles staat waar
jullie je echt een oordeel over hebben gevormd. Andersom geldt het ook: een spel
dat jullie steeds opnieuw op tafel leggen verdient daar echt krediet mee, en
krijgt zelfs zonder beoordelingen een score.</p>
<p>In de score van een spel tellen alleen de eigen beoordelingen en partijen mee,
nooit hoe het jullie andere spellen is vergaan. Dezelfde stemmen en partijen
leveren daarom in elke groep hetzelfde getal op.</p>`,
    },
    pt: {
      q: 'Por que a pontuação não bate com a média das avaliações?',
      a: `<p>Porque ela é mais do que a média. A <strong>Pontuação
Spielwirbel</strong> pondera cada voto antes de calcular a média: se alguém
<em>não quer de jeito nenhum</em> jogar um jogo, isso pesa mais do que uma boa
nota de outra pessoa.</p>
<p>O motivo é simples: pense em dois jogos com a mesma média. Com um deles está
todo mundo bem; no outro há alguém ali que preferia não jogar. São duas
recomendações bem diferentes, e a média sozinha não as distingue.</p>
<p>Enquanto ninguém tiver avaliado abaixo de «mais ou menos», a pontuação não se
afasta por esse motivo — e quando se afasta, ela diz logo ao lado o porquê, por
exemplo «1× de jeito nenhum».</p>
<p>Há um segundo motivo para ela diferir: um jogo com poucas avaliações ainda é
julgado com mais cautela. Sua pontuação fica mais perto do meio da escala até que
algumas Sessions se acumulem — assim um jogo que juntou três notas máximas numa
única noite não fica para sempre acima de tudo sobre o que vocês realmente
formaram uma opinião. O contrário também vale: um jogo que vocês colocam na mesa
sempre de novo ganha crédito de verdade por isso, e recebe pontuação mesmo sem
avaliações.</p>
<p>Na pontuação de um jogo entram só as avaliações e as partidas dele, nunca como
foram os seus outros jogos. Os mesmos votos e as mesmas partidas dão, portanto, o
mesmo número em qualquer grupo.</p>`,
    },
    fi: {
      q: 'Miksi pisteet eivät vastaa arvioiden keskiarvoa?',
      a: `<p>Koska ne ovat enemmän kuin keskiarvo. <strong>Spielwirbel-pisteet</strong>
painottavat jokaista ääntä ennen keskiarvon laskemista: jos joku <em>ei halua
lainkaan</em> pelata jotakin peliä, se painaa enemmän kuin jonkun toisen hyvä
arvio.</p>
<p>Syy on yksinkertainen: ajatelkaa kahta peliä, joilla on sama keskiarvo.
Toisessa kaikki ovat tyytyväisiä; toisessa paikalla on joku, joka mieluummin
jättäisi väliin. Ne ovat kaksi hyvin erilaista suositusta, eikä pelkkä keskiarvo
erota niitä toisistaan.</p>
<p>Niin kauan kuin kukaan ei ole arvioinut alle ”menettelee”, pisteet eivät
poikkea tästä syystä — ja kun ne poikkeavat, vieressä lukee mistä, esimerkiksi
”1× ei lainkaan”.</p>
<p>On toinenkin syy, miksi ne voivat poiketa: peliä, jolla on vasta vähän
arvioita, arvioidaan varovaisemmin. Sen pisteet pysyvät lähempänä asteikon
keskiväliä, kunnes muutama Session on kertynyt — jottei peli, joka keräsi yhtenä
iltana kolme täyttä arviota, jäisi pysyvästi kaiken sen yläpuolelle, mistä
teillä on oikeasti mielipide. Sama toimii toisinkin päin: peli, jonka nostatte
kerta toisensa jälkeen pöydälle, ansaitsee siitä oikeasti tunnustusta ja saa
pisteet ilman arvioitakin.</p>
<p>Pelin pisteisiin vaikuttavat vain sen omat arviot ja pelikerrat, ei koskaan
se, miten muilla peleillänne on mennyt. Samat äänet ja samat pelikerrat tuottavat
siis saman luvun missä tahansa porukassa.</p>`,
    },
    ko: {
      q: '점수가 왜 평점의 평균과 다른가요?',
      a: `<p>평균 이상의 것이기 때문입니다. <strong>Spielwirbel 점수</strong>는 평균을 내기 전에
각 표에 가중치를 둡니다. 누군가 어떤 게임을 <em>전혀</em> 하고 싶어 하지 않는다면, 그 의사가
다른 사람의 좋은 평가보다 더 크게 반영됩니다.</p>
<p>이유는 간단합니다. 평균이 같은 두 게임을 떠올려 보세요. 하나는 모두가 괜찮다고 하고,
다른 하나는 한 사람이 하고 싶어 하지 않습니다. 이 둘은 전혀 다른 추천이며, 평균만으로는
구분되지 않습니다.</p>
<p>아무도 ‘그럭저럭’보다 낮게 주지 않았다면 점수는 이 이유로 벌어지지 않습니다. 벌어질
때는 바로 옆에 이유가 표시됩니다. 예를 들어 ‘1× 전혀’처럼요.</p>
<p>점수가 달라지는 두 번째 이유도 있습니다. 아직 평가가 적은 게임은 더 조심스럽게
평가됩니다. Session이 몇 번 쌓일 때까지 점수가 눈금 가운데에 더 가깝게 머무릅니다. 하룻밤에
최고점 세 개를 받은 게임이 여러분이 정말로 의견을 형성한 게임들보다 영영 위에 있지 않도록
하기 위해서입니다. 반대로도 작동합니다. 계속 꺼내 드는 게임은 그만큼 실제로 인정을 받고,
평가가 없어도 점수를 얻습니다.</p>
<p>게임의 점수에는 그 게임 자체의 평가와 플레이만 반영되고, 다른 게임들이 어땠는지는 결코
반영되지 않습니다. 그래서 같은 투표와 같은 플레이는 어느 모임에서든 같은 숫자를 냅니다.</p>`,
    },
  },
  {
    id: 'badges',
    de: {
      q: 'Woher kommen die Abzeichen, und kann man sie wieder verlieren?',
      a: `<p>Die <strong>Abzeichen</strong> unter Pokale ergeben sich aus den Sessions,
die ihr eingetragen habt — für die Runde und für jede Person: der erste Sieg, zehn
Sessions, ein Spiel, das immer wieder gespielt wird. Gespeichert wird dafür nichts
Eigenes; Spielwirbel liest sie bei jedem Öffnen neu aus euren Sessions ab.</p>
<p>Deshalb verschwindet ein Abzeichen, wenn ihr die Session löscht, die es gebracht
hat — dann war es ja auch nicht verdient. Ein paar Abzeichen sind geheim und zeigen
ihren Namen erst, sobald jemand sie verdient. Was eine Session neu gebracht hat,
steht in ihrem Ergebnis, und die Chronik vermerkt es unter dieser Session.</p>`,
    },
    en: {
      q: 'Where do the badges come from, and can they be lost again?',
      a: `<p>The <strong>badges</strong> under Trophies follow from the sessions you
have recorded — for the round and for each person: the first win, ten sessions, a
game that gets played again and again. Nothing separate is stored for them;
Spielwirbel reads them off your sessions every time you open them.</p>
<p>That is why a badge disappears when you delete the session that brought it — it
was not earned then. A few badges are secret and only show their name once somebody
earns them. What a session newly brought is shown on its result, and the History
notes it under that session.</p>`,
    },
    es: {
      q: '¿De dónde salen las insignias y se pueden volver a perder?',
      a: `<p>Las <strong>insignias</strong> de Trofeos salen de las sesiones que habéis
registrado, para el grupo y para cada persona: la primera victoria, diez sesiones,
un juego que se juega una y otra vez. No se guarda nada aparte para ellas;
Spielwirbel las calcula de nuevo a partir de vuestras sesiones cada vez que las
abres.</p>
<p>Por eso una insignia desaparece si borráis la sesión que la trajo: entonces no se
había ganado. Algunas insignias son secretas y solo muestran su nombre cuando
alguien las gana. Lo que trajo una sesión aparece en su resultado, y el Historial lo
anota bajo esa sesión.</p>`,
    },
    fr: {
      q: 'D\'où viennent les badges, et peut-on les perdre ?',
      a: `<p>Les <strong>badges</strong> de Trophées découlent des sessions que vous
avez enregistrées, pour le groupe et pour chaque personne : la première victoire,
dix sessions, un jeu joué encore et encore. Rien n'est stocké à part pour eux ;
Spielwirbel les relit dans vos sessions à chaque ouverture.</p>
<p>C'est pourquoi un badge disparaît si vous supprimez la session qui l'a apporté :
il n'était alors pas mérité. Quelques badges sont secrets et ne montrent leur nom
qu'une fois gagnés. Ce qu'une session a apporté apparaît sur son résultat, et
l'Historique le note sous cette session.</p>`,
    },
    it: {
      q: 'Da dove vengono i distintivi, e si possono perdere?',
      a: `<p>I <strong>distintivi</strong> in Trofei derivano dalle sessioni che avete
registrato, per il gruppo e per ogni persona: la prima vittoria, dieci sessioni, un
gioco giocato ancora e ancora. Non si salva nulla a parte per loro; Spielwirbel li
ricava dalle vostre sessioni ogni volta che li apri.</p>
<p>Per questo un distintivo sparisce se eliminate la sessione che l'ha portato: allora
non era meritato. Alcuni distintivi sono segreti e mostrano il nome solo quando
qualcuno li ottiene. Ciò che una sessione ha portato compare nel suo risultato, e la
Cronologia lo annota sotto quella sessione.</p>`,
    },
    nl: {
      q: 'Waar komen de badges vandaan, en kun je ze weer kwijtraken?',
      a: `<p>De <strong>badges</strong> bij Trofeeën volgen uit de sessies die jullie
hebben vastgelegd, voor de groep en voor iedereen: de eerste overwinning, tien
sessies, een spel dat steeds weer gespeeld wordt. Er wordt niets apart voor
opgeslagen; Spielwirbel leest ze elke keer opnieuw af uit jullie sessies.</p>
<p>Daarom verdwijnt een badge als jullie de sessie verwijderen die hem opleverde —
dan was hij ook niet verdiend. Een paar badges zijn geheim en tonen hun naam pas
als iemand ze verdient. Wat een sessie nieuw opleverde, staat bij de uitslag, en de
Geschiedenis zet het onder die sessie.</p>`,
    },
    pt: {
      q: 'De onde vêm as insígnias, e podem perder-se?',
      a: `<p>As <strong>insígnias</strong> em Troféus resultam das sessões que
registaram, para o grupo e para cada pessoa: a primeira vitória, dez sessões, um
jogo jogado vezes sem conta. Nada é guardado à parte para elas; o Spielwirbel
calcula-as de novo a partir das vossas sessões sempre que as abres.</p>
<p>Por isso uma insígnia desaparece se apagarem a sessão que a trouxe — nesse caso
não foi conquistada. Algumas insígnias são secretas e só mostram o nome quando
alguém as conquista. O que uma sessão trouxe aparece no seu resultado, e o Histórico
regista-o por baixo dessa sessão.</p>`,
    },
    fi: {
      q: 'Mistä merkit tulevat, ja voiko ne menettää?',
      a: `<p>Palkintojen <strong>merkit</strong> syntyvät sessioista, jotka olette
kirjanneet, porukalle ja jokaiselle: ensimmäinen voitto, kymmenen sessiota, peli
jota pelataan yhä uudelleen. Niille ei tallenneta mitään erikseen; Spielwirbel
lukee ne sessioistanne joka kerta uudelleen.</p>
<p>Siksi merkki katoaa, jos poistatte session, josta se tuli — silloin sitä ei ollut
ansaittu. Muutama merkki on salainen ja näyttää nimensä vasta, kun joku ansaitsee
sen. Mitä sessio toi uutta, näkyy sen tuloksessa, ja Historia merkitsee sen sen
session alle.</p>`,
    },
    ko: {
      q: '배지는 어디서 생기고, 다시 잃을 수도 있나요?',
      a: `<p>트로피의 <strong>배지</strong>는 기록한 세션에서 생겨납니다. 모임과 한 사람
한 사람을 위한 것으로, 첫 승리, 세션 10회, 계속 다시 플레이되는 게임 같은 것들입니다.
배지를 위해 따로 저장하는 것은 없고, Spielwirbel이 열 때마다 세션에서 다시 읽어 냅니다.</p>
<p>그래서 배지를 가져다준 세션을 삭제하면 배지도 사라집니다. 그렇다면 얻은 것이 아니니까요.
몇몇 배지는 비밀이라 누군가 얻기 전까지 이름이 보이지 않습니다. 세션이 새로 가져다준 것은
그 세션의 결과에 나타나고, 기록에는 그 세션 아래에 남습니다.</p>`,
    },
  },
  {
    id: 'mail',
    gate: () => accounts.accountsEnabled(),
    de: {
      q: 'Bekomme ich dann ständig E-Mails?',
      a: `<p>Nein. Wir schreiben dir nur, wenn jemand eine Antwort von dir
braucht: bei einer <strong>Einladung zu einer Runde</strong> und bei einer
<strong>Freundschaftsanfrage</strong>. Dazu kommen die üblichen Konto-E-Mails
(Adresse bestätigen, Passwort zurücksetzen, Adressänderung bestätigen).</p>
<p>Es gibt keinen Newsletter und keine Werbung, und darüber, was deine Freunde
gerade spielen, schreiben wir dir nie. Mehr als eine Nachricht pro Stunde
bekommst du nicht — treffen mehrere Anfragen ein, fassen wir sie zusammen. Beide
Arten kannst du in deinem Konto einzeln abschalten.</p>`,
    },
    en: {
      q: 'Will you keep e-mailing me?',
      a: `<p>No. We only write when someone needs an answer from you: a
<strong>round invitation</strong> or a <strong>friend request</strong>. On top of
that there are the usual account e-mails (confirm your address, reset your
password, confirm an address change).</p>
<p>There is no newsletter and no advertising, and we never write to you about
what your friends are playing. You will not get more than one message an hour —
if several requests arrive, we combine them. You can switch both kinds off
individually in your account.</p>`,
    },
    es: {
      q: '¿Me vais a escribir todo el rato?',
      a: `<p>No. Solo escribimos cuando alguien necesita una respuesta tuya: una
<strong>invitación a un grupo</strong> y una <strong>solicitud de amistad</strong>.
A eso se suman los correos de cuenta habituales (confirmar la dirección,
restablecer la contraseña, confirmar un cambio de dirección).</p>
<p>No hay boletín ni publicidad, y nunca te escribimos sobre a qué están jugando
tus amigos. No recibirás más de un mensaje por hora: si llegan varias
solicitudes, las juntamos. Puedes desactivar ambos tipos por separado en tu
cuenta.</p>`,
    },
    fr: {
      q: 'Allez-vous m’écrire sans arrêt ?',
      a: `<p>Non. Nous n’écrivons que lorsque quelqu’un attend une réponse de toi :
une <strong>invitation à un groupe</strong> et une <strong>demande d’ami</strong>.
S’y ajoutent les e-mails de compte habituels (confirmer l’adresse, réinitialiser
le mot de passe, confirmer un changement d’adresse).</p>
<p>Il n’y a ni newsletter ni publicité, et nous ne t’écrivons jamais à propos de
ce que jouent tes amis. Tu ne recevras pas plus d’un message par heure : si
plusieurs demandes arrivent, nous les regroupons. Tu peux désactiver les deux
types séparément dans ton compte.</p>`,
    },
    it: {
      q: 'Mi scriverete di continuo?',
      a: `<p>No. Scriviamo solo quando qualcuno aspetta una risposta da te: un
<strong>invito a un gruppo</strong> e una <strong>richiesta di amicizia</strong>.
A questo si aggiungono le solite e-mail di account (confermare l’indirizzo,
reimpostare la password, confermare un cambio di indirizzo).</p>
<p>Non c’è newsletter né pubblicità, e non ti scriviamo mai di cosa stanno
giocando i tuoi amici. Non riceverai più di un messaggio all’ora: se arrivano più
richieste, le raggruppiamo. Puoi disattivare separatamente entrambi i tipi nel
tuo account.</p>`,
    },
    nl: {
      q: 'Krijg ik dan voortdurend mails?',
      a: `<p>Nee. We schrijven alleen als iemand een antwoord van je nodig heeft:
een <strong>uitnodiging voor een groep</strong> en een
<strong>vriendschapsverzoek</strong>. Daarbij komen de gebruikelijke
account-mails (adres bevestigen, wachtwoord herstellen, een adreswijziging
bevestigen).</p>
<p>Er is geen nieuwsbrief en geen reclame, en we schrijven je nooit over wat je
vrienden spelen. Je krijgt niet meer dan één bericht per uur: komen er meerdere
verzoeken binnen, dan voegen we ze samen. Beide soorten kun je in je account
afzonderlijk uitzetten.</p>`,
    },
    pt: {
      q: 'Vocês vão ficar me mandando e-mails?',
      a: `<p>Não. Só escrevemos quando alguém precisa de uma resposta sua: um
<strong>convite para um grupo</strong> e um <strong>pedido de amizade</strong>.
Além disso há os e-mails de conta de sempre (confirmar o endereço, redefinir a
senha, confirmar uma alteração de endereço).</p>
<p>Não existe newsletter nem publicidade, e nunca escrevemos sobre o que os seus
amigos estão jogando. Você não recebe mais de uma mensagem por hora: se chegarem
vários pedidos, nós os juntamos. Dá para desligar os dois tipos separadamente na
sua conta.</p>`,
    },
    fi: {
      q: 'Tuleeko minulle jatkuvasti sähköposteja?',
      a: `<p>Ei. Kirjoitamme vain silloin, kun joku odottaa sinulta vastausta:
<strong>kutsu porukkaan</strong> ja <strong>kaveripyyntö</strong>. Lisäksi tulevat
tavanomaiset tilisähköpostit (osoitteen vahvistus, salasanan palautus,
osoitteenmuutoksen vahvistus).</p>
<p>Uutiskirjettä tai mainoksia ei ole, emmekä koskaan kirjoita sinulle siitä,
mitä kaverisi pelaavat. Et saa enempää kuin yhden viestin tunnissa: jos useampi
pyyntö saapuu, yhdistämme ne. Voit kytkeä molemmat tyypit erikseen pois päältä
tililläsi.</p>`,
    },
    ko: {
      q: '메일이 계속 오나요?',
      a: `<p>아니요. 누군가 답을 기다릴 때만 보냅니다. <strong>모임 초대</strong>와
<strong>친구 요청</strong>입니다. 여기에 계정 관련 메일(주소 확인, 비밀번호 재설정, 주소 변경 확인)이
더해집니다.</p>
<p>뉴스레터도 광고도 없고, 친구들이 무엇을 플레이하는지에 대해서는 결코 메일을 보내지
않습니다. 한 시간에 한 통을 넘기지 않으며, 요청이 여러 개 오면 하나로 묶어 보냅니다. 두
종류 모두 계정에서 따로따로 끌 수 있습니다.</p>`,
    },
  },
  {
    id: 'free',
    de: {
      q: 'Ist das wirklich kostenlos? Wo ist der Haken?',
      a: `<p>Es gibt keinen. Es gibt keine kostenpflichtige Stufe, keine
Funktionen hinter einer Bezahlschranke und keine Werbung.</p>
<p>Es sind auch keine Analyse- oder Tracking-Skripte eingebaut und es werden
keine Skripte von Dritten geladen — es gibt schlicht nichts, was hier
weiterverkauft würde.</p>`,
    },
    en: {
      q: 'Is it really free? What is the catch?',
      a: `<p>There isn't one. There is no paid tier, no feature behind a
paywall, and no advertising.</p>
<p>There are no analytics or tracking scripts either, and no third-party
scripts are loaded — there is simply nothing here to resell.</p>`,
    },
    es: {
      q: '¿De verdad es gratis? ¿Dónde está la trampa?',
      a: `<p>No la hay. No existe una versión de pago, ninguna función tras un muro
de pago y ninguna publicidad.</p>
<p>Tampoco hay analítica ni scripts de seguimiento, y no se carga ningún script
de terceros: sencillamente no hay nada aquí que revender.</p>`,
    },
    fr: {
      q: 'C’est vraiment gratuit ? Où est le piège ?',
      a: `<p>Il n’y en a pas. Il n’existe pas de version payante, aucune fonction
derrière un paywall et aucune publicité.</p>
<p>Il n’y a pas non plus d’analytique ni de scripts de pistage, et aucun script
tiers n’est chargé : il n’y a tout simplement rien à revendre ici.</p>`,
    },
    it: {
      q: 'È davvero gratis? Dov’è la fregatura?',
      a: `<p>Non c’è. Non esiste una versione a pagamento, nessuna funzione dietro
un paywall e nessuna pubblicità.</p>
<p>Non ci sono nemmeno analytics o script di tracciamento, e non viene caricato
alcuno script di terze parti: qui non c’è semplicemente nulla da rivendere.</p>`,
    },
    nl: {
      q: 'Is het echt gratis? Waar zit het addertje?',
      a: `<p>Dat is er niet. Er is geen betaalde versie, geen functie achter een
betaalmuur en geen reclame.</p>
<p>Er is ook geen analytics of tracking, en er worden geen scripts van derden
geladen — er valt hier eenvoudigweg niets door te verkopen.</p>`,
    },
    pt: {
      q: 'É realmente grátis? Onde está a pegadinha?',
      a: `<p>Não há nenhuma. Não existe versão paga, nenhum recurso atrás de um
paywall e nenhuma publicidade.</p>
<p>Também não há analytics nem scripts de rastreamento, e nenhum script de
terceiros é carregado — simplesmente não há nada aqui para revender.</p>`,
    },
    fi: {
      q: 'Onko tämä oikeasti ilmainen? Missä on koukku?',
      a: `<p>Ei ole. Maksullista versiota ei ole, mikään ominaisuus ei ole
maksumuurin takana eikä mainoksia ole.</p>
<p>Analytiikkaa tai seurantaskriptejä ei myöskään ole, eikä kolmannen osapuolen
skriptejä ladata — täällä ei yksinkertaisesti ole mitään myytävää eteenpäin.</p>`,
    },
    ko: {
      q: '정말 무료인가요? 함정은 없나요?',
      a: `<p>없습니다. 유료 요금제도, 결제 뒤에 숨겨 둔 기능도, 광고도 없습니다.</p>
<p>분석 도구나 추적 스크립트도 없고 외부 스크립트도 전혀 불러오지 않습니다. 여기에는 되팔
것이 아예 없습니다.</p>`,
    },
  },
  {
    id: 'donations',
    gate: donationsConfigured,
    de: {
      q: 'Wozu dann der Spenden-Button?',
      a: `<p>Spenden sind freiwillig und schalten <strong>nichts</strong> frei —
wer spendet, bekommt keine zusätzlichen Funktionen, und wer nicht spendet,
verliert keine.</p>
<p>Wohin es geht: Server, Datenbank, Domain und Mailversand kosten laufend Geld,
und Betrieb, Wartung und neue Funktionen kosten Zeit. Spielwirbel wird
nebenher entwickelt und aus eigener Tasche bezahlt — eine Spende ist schlicht
ein Danke dafür.</p>
<p>Die App enthält keinen Bezahl-Code und bindet kein fremdes Widget ein: Zur
Spendenplattform wird erst dann überhaupt eine Verbindung aufgebaut, wenn du
den Link anklickst.</p>`,
    },
    en: {
      q: 'So what is the donate button for?',
      a: `<p>Donations are voluntary and unlock <strong>nothing</strong> —
donating gets you no extra features, and not donating costs you none.</p>
<p>Where it goes: servers, the database, the domain and sending mail cost money
every month, and running, maintaining and building Spielwirbel costs time. It is
developed on the side and paid for out of pocket — a donation is simply a thank
you for that.</p>
<p>The app contains no payment code and embeds no third-party widget: nothing
is loaded from (or sent to) the donation platform until you click the link.</p>`,
    },
    es: {
      q: 'Entonces, ¿para qué sirve el botón de donar?',
      a: `<p>Las donaciones son voluntarias y no desbloquean <strong>nada</strong>:
donar no te da funciones extra, y no donar no te cuesta ninguna.</p>
<p>A dónde va: los servidores, la base de datos, el dominio y el envío de correo
cuestan dinero cada mes, y hacer funcionar, mantener y desarrollar Spielwirbel
cuesta tiempo. Se desarrolla como algo secundario y se paga del propio bolsillo;
una donación es sencillamente un agradecimiento por ello.</p>
<p>La aplicación no contiene código de pago ni incrusta ningún widget de
terceros: no se carga nada desde la plataforma de donaciones (ni se le envía
nada) hasta que pulsas el enlace.</p>`,
    },
    fr: {
      q: 'À quoi sert alors le bouton de don ?',
      a: `<p>Les dons sont volontaires et ne débloquent <strong>rien</strong> :
donner ne t’apporte aucune fonction supplémentaire, et ne pas donner ne t’en
coûte aucune.</p>
<p>Où cela va : les serveurs, la base de données, le domaine et l’envoi d’e-mails
coûtent de l’argent chaque mois, et faire tourner, entretenir et développer
Spielwirbel coûte du temps. C’est développé à côté et payé de sa poche — un don
est simplement un merci pour cela.</p>
<p>L’application ne contient aucun code de paiement et n’intègre aucun widget
tiers : rien n’est chargé depuis la plateforme de dons (ni envoyé vers elle) tant
que tu ne cliques pas sur le lien.</p>`,
    },
    it: {
      q: 'A cosa serve allora il pulsante per le donazioni?',
      a: `<p>Le donazioni sono volontarie e non sbloccano <strong>nulla</strong>:
donare non ti dà funzioni in più, e non donare non te ne toglie nessuna.</p>
<p>Dove va: server, database, dominio e invio delle e-mail costano ogni mese, e
far funzionare, mantenere e sviluppare Spielwirbel costa tempo. Viene sviluppato
a margine e pagato di tasca propria — una donazione è semplicemente un grazie per
questo.</p>
<p>L’app non contiene codice di pagamento e non incorpora alcun widget di terze
parti: dalla piattaforma di donazioni non viene caricato (né a essa inviato)
nulla finché non clicchi sul link.</p>`,
    },
    nl: {
      q: 'Waar is die doneerknop dan voor?',
      a: `<p>Donaties zijn vrijwillig en ontgrendelen <strong>niets</strong>:
doneren levert je geen extra functies op, en niet doneren kost je er geen.</p>
<p>Waar het heen gaat: servers, de database, het domein en het versturen van mail
kosten elke maand geld, en Spielwirbel draaiende houden, onderhouden en bouwen
kost tijd. Het wordt ernaast ontwikkeld en uit eigen zak betaald — een donatie is
simpelweg een bedankje daarvoor.</p>
<p>De app bevat geen betaalcode en sluit geen widget van derden in: er wordt
niets van het donatieplatform geladen (of ernaartoe gestuurd) totdat je op de
link klikt.</p>`,
    },
    pt: {
      q: 'Então para que serve o botão de doação?',
      a: `<p>As doações são voluntárias e não desbloqueiam <strong>nada</strong>:
doar não te dá recursos extras, e não doar não te custa nenhum.</p>
<p>Para onde vai: os servidores, o banco de dados, o domínio e o envio de e-mails
custam dinheiro todo mês, e manter, cuidar e desenvolver o Spielwirbel custa
tempo. É desenvolvido nas horas vagas e pago do próprio bolso — uma doação é
simplesmente um obrigado por isso.</p>
<p>O app não tem código de pagamento e não embute nenhum widget de terceiros:
nada é carregado da plataforma de doações (nem enviado a ela) até você clicar no
link.</p>`,
    },
    fi: {
      q: 'Mitä varten lahjoituspainike sitten on?',
      a: `<p>Lahjoitukset ovat vapaaehtoisia eivätkä avaa
<strong>mitään</strong>: lahjoittaminen ei tuo lisäominaisuuksia, eikä
lahjoittamatta jättäminen vie niitä.</p>
<p>Mihin se menee: palvelimet, tietokanta, verkkotunnus ja sähköpostin
lähettäminen maksavat joka kuukausi, ja Spielwirbelin pyörittäminen,
ylläpitäminen ja kehittäminen vie aikaa. Sitä kehitetään muun ohessa ja
maksetaan omasta pussista — lahjoitus on yksinkertaisesti kiitos siitä.</p>
<p>Sovelluksessa ei ole maksukoodia eikä siihen ole upotettu kolmannen osapuolen
vimpainta: lahjoitusalustalta ei ladata (eikä sinne lähetetä) mitään ennen kuin
napsautat linkkiä.</p>`,
    },
    ko: {
      q: '그럼 후원 버튼은 왜 있나요?',
      a: `<p>후원은 자발적이며 <strong>아무것도</strong> 열어 주지 않습니다. 후원한다고 추가 기능이
생기지 않고, 하지 않는다고 기능이 사라지지도 않습니다.</p>
<p>쓰임새는 이렇습니다. 서버, 데이터베이스, 도메인, 메일 발송에는 매달 돈이 들고,
Spielwirbel을 운영하고 유지하고 만드는 데는 시간이 듭니다. 본업 곁에서 개발하고 비용은
직접 부담하고 있으며, 후원은 그저 그에 대한 감사 표시입니다.</p>
<p>앱에는 결제 코드가 없고 외부 위젯도 넣지 않았습니다. 링크를 누르기 전까지는 후원
플랫폼에서 아무것도 불러오지 않고, 그쪽으로 보내지도 않습니다.</p>`,
    },
  },
  {
    id: 'app',
    de: {
      q: 'Gibt es eine App?',
      a: `<p>Jein. Spielwirbel lässt sich über den Browser <strong>zum
Startbildschirm hinzufügen</strong> und verhält sich danach wie eine App:
eigenes Icon, eigenes Fenster, funktioniert auch offline.</p>
<p>Im Bereich <strong>Konto</strong> findest du dafür einen eigenen Abschnitt —
je nach Browser mit einem Installieren-Knopf oder mit den zwei Schritten über
das Teilen-Menü.</p>
<p>Einen Eintrag im App Store oder bei Google Play gibt es nicht.</p>`,
    },
    en: {
      q: 'Is there an app?',
      a: `<p>Yes and no. Spielwirbel can be <strong>added to your home
screen</strong> from the browser and behaves like an app afterwards: its own
icon, its own window, and it works offline.</p>
<p>The <strong>Account</strong> screen has a section for it — either an install
button or the two Share-menu steps, depending on your browser.</p>
<p>There is no App Store or Google Play listing.</p>`,
    },
    es: {
      q: '¿Hay una aplicación?',
      a: `<p>Sí y no. Spielwirbel se puede <strong>añadir a la pantalla de
inicio</strong> desde el navegador y a partir de ahí se comporta como una
aplicación: icono propio, ventana propia y funciona sin conexión.</p>
<p>La pantalla <strong>Cuenta</strong> tiene una sección para ello: o un botón de
instalación o los dos pasos del menú Compartir, según tu navegador.</p>
<p>No hay ficha en la App Store ni en Google Play.</p>`,
    },
    fr: {
      q: 'Existe-t-il une application ?',
      a: `<p>Oui et non. Spielwirbel peut être <strong>ajouté à l’écran
d’accueil</strong> depuis le navigateur et se comporte ensuite comme une
application : icône propre, fenêtre propre, et il fonctionne hors ligne.</p>
<p>L’écran <strong>Compte</strong> comporte une section pour cela : soit un
bouton d’installation, soit les deux étapes du menu Partager, selon ton
navigateur.</p>
<p>Il n’y a pas de fiche sur l’App Store ni sur Google Play.</p>`,
    },
    it: {
      q: 'Esiste un’app?',
      a: `<p>Sì e no. Spielwirbel si può <strong>aggiungere alla schermata
iniziale</strong> dal browser e da lì in poi si comporta come un’app: icona
propria, finestra propria, e funziona anche offline.</p>
<p>La schermata <strong>Account</strong> ha una sezione apposita: o un pulsante
di installazione o i due passaggi del menu Condividi, a seconda del browser.</p>
<p>Non c’è una scheda su App Store o Google Play.</p>`,
    },
    nl: {
      q: 'Is er een app?',
      a: `<p>Ja en nee. Spielwirbel kan vanuit de browser
<strong>aan je beginscherm worden toegevoegd</strong> en gedraagt zich daarna als
een app: een eigen pictogram, een eigen venster, en het werkt offline.</p>
<p>Het scherm <strong>Account</strong> heeft er een onderdeel voor: of een
installatieknop of de twee stappen uit het deelmenu, afhankelijk van je
browser.</p>
<p>Er is geen vermelding in de App Store of Google Play.</p>`,
    },
    pt: {
      q: 'Existe um aplicativo?',
      a: `<p>Sim e não. O Spielwirbel pode ser <strong>adicionado à tela
inicial</strong> pelo navegador e daí em diante se comporta como um app: ícone
próprio, janela própria, e funciona offline.</p>
<p>A tela <strong>Conta</strong> tem uma seção para isso: ou um botão de
instalação ou os dois passos do menu Compartilhar, dependendo do seu
navegador.</p>
<p>Não há ficha na App Store nem no Google Play.</p>`,
    },
    fi: {
      q: 'Onko tästä sovellusta?',
      a: `<p>Kyllä ja ei. Spielwirbelin voi <strong>lisätä aloitusnäytölle</strong>
selaimesta, ja sen jälkeen se käyttäytyy kuin sovellus: oma kuvake, oma ikkuna,
ja se toimii myös verkotta.</p>
<p><strong>Tili</strong>-näkymässä on tätä varten oma osio: joko
asennuspainike tai jakovalikon kaksi vaihetta, selaimesta riippuen.</p>
<p>App Storessa tai Google Playssa sitä ei ole.</p>`,
    },
    ko: {
      q: '앱이 있나요?',
      a: `<p>있기도 하고 없기도 합니다. Spielwirbel은 브라우저에서
<strong>홈 화면에 추가</strong>할 수 있고, 그 뒤에는 앱처럼 동작합니다. 전용 아이콘과 전용
창이 생기고 오프라인에서도 작동합니다.</p>
<p><strong>계정</strong> 화면에 이를 위한 항목이 있습니다. 브라우저에 따라 설치 버튼이
나오거나 공유 메뉴의 두 단계가 안내됩니다.</p>
<p>App Store나 Google Play에는 등록되어 있지 않습니다.</p>`,
    },
  },
  {
    id: 'boardgames',
    de: {
      q: 'Geht das nur für Brettspiele?',
      a: `<p>Die Titelsuche ja: Beim Anlegen eines Spiels sucht das Titelfeld bei
<strong>BoardGameGeek</strong> und übernimmt Titel, Cover und Spieleranzahl.</p>
<p>Ins Regal darf aber alles. Von Hand eintragen geht genauso — dann ist völlig
egal, was für ein Spiel es ist, es wird nur nichts automatisch ausgefüllt.</p>`,
    },
    en: {
      q: 'Is it only for board games?',
      a: `<p>The title search is: when you add a game, the title field searches
<strong>BoardGameGeek</strong> and fills in the title, cover art and player
count for you.</p>
<p>The shelf itself takes anything. Typing a game in by hand works just as well —
it can then be whatever you like, it just won't fill itself in.</p>`,
    },
    es: {
      q: '¿Solo sirve para juegos de mesa?',
      a: `<p>La búsqueda de títulos sí: al añadir un juego, el campo del título
busca en <strong>BoardGameGeek</strong> y rellena por ti el título, la portada y
el número de jugadores.</p>
<p>La estantería en sí admite cualquier cosa. Escribir un juego a mano funciona
igual de bien: entonces puede ser lo que queráis, solo que no se rellenará
solo.</p>`,
    },
    fr: {
      q: 'Est-ce réservé aux jeux de société ?',
      a: `<p>La recherche de titres, oui : quand tu ajoutes un jeu, le champ du
titre interroge <strong>BoardGameGeek</strong> et remplit pour toi le titre, la
jaquette et le nombre de joueurs.</p>
<p>L’étagère, elle, accepte n’importe quoi. Saisir un jeu à la main marche tout
aussi bien — ce peut alors être ce que vous voulez, cela ne se remplira
simplement pas tout seul.</p>`,
    },
    it: {
      q: 'Vale solo per i giochi da tavolo?',
      a: `<p>La ricerca dei titoli sì: quando aggiungi un gioco, il campo del
titolo cerca su <strong>BoardGameGeek</strong> e compila per te titolo, copertina
e numero di giocatori.</p>
<p>Lo scaffale in sé accetta qualsiasi cosa. Digitare un gioco a mano funziona
altrettanto bene — può essere ciò che volete, semplicemente non si compilerà da
solo.</p>`,
    },
    nl: {
      q: 'Is het alleen voor bordspellen?',
      a: `<p>Het zoeken op titel wel: als je een spel toevoegt, zoekt het titelveld
op <strong>BoardGameGeek</strong> en vult het de titel, de cover en het
spelersaantal voor je in.</p>
<p>De kast zelf neemt alles aan. Een spel met de hand intypen werkt net zo goed —
het kan dan zijn wat jullie willen, het vult zichzelf alleen niet in.</p>`,
    },
    pt: {
      q: 'Serve só para jogos de tabuleiro?',
      a: `<p>A busca por título, sim: ao adicionar um jogo, o campo do título
procura no <strong>BoardGameGeek</strong> e preenche para você o título, a capa e
o número de jogadores.</p>
<p>A estante em si aceita qualquer coisa. Digitar um jogo à mão funciona
igualmente bem — aí pode ser o que vocês quiserem, só não vai se preencher
sozinho.</p>`,
    },
    fi: {
      q: 'Sopiiko tämä vain lautapeleille?',
      a: `<p>Nimihaku kyllä: kun lisäät pelin, nimikenttä hakee
<strong>BoardGameGeekistä</strong> ja täyttää puolestasi nimen, kansikuvan ja
pelaajamäärän.</p>
<p>Hylly itsessään ottaa vastaan mitä tahansa. Pelin voi kirjoittaa myös käsin —
silloin se voi olla mitä haluatte, se ei vain täytä itseään.</p>`,
    },
    ko: {
      q: '보드게임에만 쓸 수 있나요?',
      a: `<p>제목 검색은 그렇습니다. 게임을 추가할 때 제목 칸이
<strong>BoardGameGeek</strong>에서 검색해 제목, 표지, 인원수를 대신 채워 줍니다.</p>
<p>선반 자체는 무엇이든 받아들입니다. 게임을 직접 입력해도 똑같이 잘 되며, 그때는 원하는
무엇이든 될 수 있고 다만 자동으로 채워지지 않을 뿐입니다.</p>`,
    },
  },
  {
    id: 'export',
    gate: () => legal.legalConfigured(),
    de: {
      q: 'Kommen wir an unsere Daten wieder heran?',
      a: `<p>Ja. Schreib uns über das <a href="/kontakt.html">Kontaktformular</a>,
dann bekommst du deine Daten heraus. Wie das abläuft, steht in der
<a href="/datenschutz">Datenschutzerklärung</a>.</p>
<p>Einen vollständigen Export direkt in der App — ein Klick, eine Datei — gibt es
derzeit nicht. Einzelne gespielte Partien kannst du aber an
<strong>BG Stats</strong> übergeben, wenn du das in deinem Konto einschaltest:
Auf der Ergebnisseite einer beendeten Session erscheint der Link unter den
Gewinnerinnen und Gewinnern und überträgt die Partie dorthin.</p>`,
    },
    en: {
      q: 'Can we get our data back out?',
      a: `<p>Yes. Get in touch through the <a href="/kontakt.html">contact
form</a> and you will get your data. How that works is described in the
<a href="/datenschutz">privacy policy</a>.</p>
<p>There is currently no one-click full export from inside the app itself. You
can, however, send individual plays to <strong>BG Stats</strong> once you switch
that on in your account: on a finished session's results screen the link sits
under the winners and hands the play across.</p>`,
    },
    es: {
      q: '¿Podemos recuperar nuestros datos?',
      a: `<p>Sí. Escríbenos por el <a href="/kontakt.html">formulario de
contacto</a> y recibirás tus datos. Cómo funciona está descrito en la
<a href="/datenschutz">política de privacidad</a>.</p>
<p>Por ahora no hay una exportación completa con un clic dentro de la propia
aplicación. Sí puedes, en cambio, enviar partidas sueltas a <strong>BG
Stats</strong> una vez que lo actives en tu cuenta: en la pantalla de resultados
de una Session terminada, el enlace está bajo los ganadores y entrega la
partida.</p>`,
    },
    fr: {
      q: 'Pouvons-nous récupérer nos données ?',
      a: `<p>Oui. Écris-nous via le <a href="/kontakt.html">formulaire de
contact</a> et tu recevras tes données. Le fonctionnement est décrit dans la
<a href="/datenschutz">politique de confidentialité</a>.</p>
<p>Il n’existe pour l’instant pas d’export complet en un clic depuis
l’application elle-même. Tu peux en revanche envoyer des parties individuelles
vers <strong>BG Stats</strong> une fois l’option activée dans ton compte : sur
l’écran de résultats d’une Session terminée, le lien se trouve sous les gagnants
et transmet la partie.</p>`,
    },
    it: {
      q: 'Possiamo riavere i nostri dati?',
      a: `<p>Sì. Scrivici tramite il <a href="/kontakt.html">modulo di
contatto</a> e riceverai i tuoi dati. Come funziona è descritto
nell’<a href="/datenschutz">informativa sulla privacy</a>.</p>
<p>Al momento non esiste un’esportazione completa con un clic dall’app stessa.
Puoi però inviare singole partite a <strong>BG Stats</strong> una volta attivata
l’opzione nel tuo account: nella schermata dei risultati di una Session conclusa
il collegamento si trova sotto i vincitori e consegna la partita.</p>`,
    },
    nl: {
      q: 'Kunnen we onze gegevens weer terugkrijgen?',
      a: `<p>Ja. Neem contact op via het <a href="/kontakt.html">contactformulier</a>
en je krijgt je gegevens. Hoe dat werkt staat beschreven in de
<a href="/datenschutz">privacyverklaring</a>.</p>
<p>Een volledige export met één klik vanuit de app zelf is er op dit moment niet.
Losse partijen kun je wel naar <strong>BG Stats</strong> sturen zodra je dat in
je account aanzet: op het resultatenscherm van een afgeronde Session staat de
link onder de winnaars en geeft de partij door.</p>`,
    },
    pt: {
      q: 'Dá para recuperar os nossos dados?',
      a: `<p>Sim. Fale com a gente pelo <a href="/kontakt.html">formulário de
contato</a> e você recebe os seus dados. Como isso funciona está descrito na
<a href="/datenschutz">política de privacidade</a>.</p>
<p>No momento não há uma exportação completa com um clique de dentro do próprio
app. Você pode, porém, enviar partidas individuais para o <strong>BG
Stats</strong> depois de ativar isso na sua conta: na tela de resultados de uma
Session encerrada, o link fica abaixo dos vencedores e passa a partida
adiante.</p>`,
    },
    fi: {
      q: 'Saammeko tietomme takaisin?',
      a: `<p>Kyllä. Ota yhteyttä <a href="/kontakt.html">yhteydenottolomakkeella</a>,
niin saat tietosi. Miten se toimii, on kuvattu
<a href="/datenschutz">tietosuojaselosteessa</a>.</p>
<p>Yhden napsautuksen kokonaisvientiä itse sovelluksesta ei tällä hetkellä ole.
Yksittäisiä pelikertoja voit sen sijaan lähettää <strong>BG Statsiin</strong>,
kun kytket sen päälle tililläsi: päättyneen Sessionin tulosnäkymässä linkki on
voittajien alla ja luovuttaa pelikerran eteenpäin.</p>`,
    },
    ko: {
      q: '우리 데이터를 다시 받을 수 있나요?',
      a: `<p>네. <a href="/kontakt.html">문의 양식</a>으로 연락하시면 데이터를 받으실 수
있습니다. 그 절차는 <a href="/datenschutz">개인정보처리방침</a>에 설명되어 있습니다.</p>
<p>현재 앱 안에서 한 번에 전체를 내보내는 기능은 없습니다. 다만 계정에서 켜 두면 개별
플레이를 <strong>BG Stats</strong>로 보낼 수 있습니다. 끝난 Session의 결과 화면에서 우승자
아래에 링크가 있고, 그 플레이를 넘겨 줍니다.</p>`,
    },
  },
  {
    id: 'data',
    gate: () => legal.legalConfigured(),
    de: {
      q: 'Wo liegen unsere Daten?',
      a: `<p>Das hängt davon ab, wer diese Instanz betreibt. Welche Dienstleister
eingesetzt werden und wo gespeichert wird, steht vollständig in der
<a href="/datenschutz">Datenschutzerklärung</a> — wir schreiben es hier
absichtlich nicht in eigenen Worten daneben, damit es nur eine verbindliche
Fassung gibt.</p>`,
    },
    en: {
      q: 'Where is our data stored?',
      a: `<p>That depends on who runs this instance. Which providers are used and
where data is stored is set out in full in the <a href="/datenschutz">privacy
policy</a> — deliberately not restated here in different words, so that there is
only one binding version.</p>`,
    },
    es: {
      q: '¿Dónde están nuestros datos?',
      a: `<p>Depende de quién gestione esta instancia. Qué proveedores se usan y
dónde se guardan los datos está expuesto por completo en la
<a href="/datenschutz">política de privacidad</a> — deliberadamente no repetido
aquí con otras palabras, para que haya una sola versión vinculante.</p>`,
    },
    fr: {
      q: 'Où sont stockées nos données ?',
      a: `<p>Cela dépend de qui exploite cette instance. Quels prestataires sont
utilisés et où les données sont stockées est exposé intégralement dans la
<a href="/datenschutz">politique de confidentialité</a> — délibérément non
reformulé ici, pour qu’il n’existe qu’une seule version qui fasse foi.</p>`,
    },
    it: {
      q: 'Dove sono i nostri dati?',
      a: `<p>Dipende da chi gestisce questa istanza. Quali fornitori vengono usati
e dove sono conservati i dati è esposto per intero
nell’<a href="/datenschutz">informativa sulla privacy</a> — deliberatamente non
ripetuto qui con altre parole, così che esista una sola versione vincolante.</p>`,
    },
    nl: {
      q: 'Waar staan onze gegevens?',
      a: `<p>Dat hangt af van wie deze instantie beheert. Welke dienstverleners
worden gebruikt en waar gegevens worden opgeslagen staat volledig in de
<a href="/datenschutz">privacyverklaring</a> — hier bewust niet in andere
woorden herhaald, zodat er maar één bindende versie is.</p>`,
    },
    pt: {
      q: 'Onde ficam os nossos dados?',
      a: `<p>Depende de quem opera esta instância. Quais provedores são usados e
onde os dados ficam guardados está exposto por completo na
<a href="/datenschutz">política de privacidade</a> — de propósito não repetido
aqui com outras palavras, para que exista apenas uma versão vinculante.</p>`,
    },
    fi: {
      q: 'Missä tietomme ovat?',
      a: `<p>Se riippuu siitä, kuka tätä instanssia ylläpitää. Mitä palveluntarjoajia
käytetään ja missä tiedot säilytetään, on esitetty kokonaisuudessaan
<a href="/datenschutz">tietosuojaselosteessa</a> — tässä sitä ei tarkoituksella
toisteta toisin sanoin, jotta sitovia versioita on vain yksi.</p>`,
    },
    ko: {
      q: '우리 데이터는 어디에 있나요?',
      a: `<p>이 인스턴스를 누가 운영하는지에 따라 다릅니다. 어떤 제공업체를 쓰고 데이터를
어디에 보관하는지는 <a href="/datenschutz">개인정보처리방침</a>에 빠짐없이 적혀
있습니다. 구속력 있는 판본이 하나만 존재하도록, 여기서 다른 표현으로 되풀이하지
않습니다.</p>`,
    },
  },
  {
    id: 'maintenance',
    de: {
      q: 'Was passiert, wenn ihr aufhört?',
      a: `<p>Der Quellcode ist öffentlich und lesbar:
<a href="${REPO_URL}" rel="noopener">${REPO_URL.replace('https://', '')}</a>.
Er darf für nicht-kommerzielle Zwecke selbst betrieben werden — wer will, kann
Spielwirbel also auf einem eigenen Server weiterlaufen lassen.</p>
<p>Das ist keine Garantie, dass der Dienst ewig läuft. Es ist die Zusage, dass
er nicht mit einer Person verschwindet.</p>`,
    },
    en: {
      q: 'What happens if you stop maintaining this?',
      a: `<p>The source code is public and readable:
<a href="${REPO_URL}" rel="noopener">${REPO_URL.replace('https://', '')}</a>.
It may be self-hosted for noncommercial purposes — so anyone who wants to can
keep Spielwirbel running on their own server.</p>
<p>That is not a promise that the service runs forever. It is a promise that it
does not disappear with one person.</p>`,
    },
    es: {
      q: '¿Qué pasa si dejáis de mantenerlo?',
      a: `<p>El código fuente es público y legible:
<a href="https://github.com/ChulioZ/spielwirbel" rel="noopener">github.com/ChulioZ/spielwirbel</a>.
Se puede alojar por cuenta propia con fines no comerciales, así que quien quiera
puede mantener Spielwirbel en marcha en su propio servidor.</p>
<p>Eso no es una promesa de que el servicio funcione para siempre. Es la promesa
de que no desaparece con una sola persona.</p>`,
    },
    fr: {
      q: 'Que se passe-t-il si vous arrêtez ?',
      a: `<p>Le code source est public et lisible :
<a href="https://github.com/ChulioZ/spielwirbel" rel="noopener">github.com/ChulioZ/spielwirbel</a>.
Il peut être hébergé par soi-même à des fins non commerciales — qui le souhaite
peut donc garder Spielwirbel en service sur son propre serveur.</p>
<p>Ce n’est pas la promesse que le service tournera pour toujours. C’est la
promesse qu’il ne disparaît pas avec une seule personne.</p>`,
    },
    it: {
      q: 'Che succede se smettete?',
      a: `<p>Il codice sorgente è pubblico e leggibile:
<a href="https://github.com/ChulioZ/spielwirbel" rel="noopener">github.com/ChulioZ/spielwirbel</a>.
Può essere ospitato in proprio per scopi non commerciali — chi vuole può quindi
tenere Spielwirbel in funzione sul proprio server.</p>
<p>Non è la promessa che il servizio duri per sempre. È la promessa che non
sparisce insieme a una sola persona.</p>`,
    },
    nl: {
      q: 'Wat gebeurt er als jullie ermee stoppen?',
      a: `<p>De broncode is openbaar en leesbaar:
<a href="https://github.com/ChulioZ/spielwirbel" rel="noopener">github.com/ChulioZ/spielwirbel</a>.
Hij mag voor niet-commerciële doeleinden zelf gehost worden — wie wil, kan
Spielwirbel dus op een eigen server draaiende houden.</p>
<p>Dat is geen belofte dat de dienst eeuwig blijft draaien. Het is de belofte dat
hij niet met één persoon verdwijnt.</p>`,
    },
    pt: {
      q: 'O que acontece se vocês pararem?',
      a: `<p>O código-fonte é público e legível:
<a href="https://github.com/ChulioZ/spielwirbel" rel="noopener">github.com/ChulioZ/spielwirbel</a>.
Ele pode ser hospedado por conta própria para fins não comerciais — então quem
quiser pode manter o Spielwirbel no ar no seu próprio servidor.</p>
<p>Isso não é uma promessa de que o serviço vai durar para sempre. É a promessa
de que ele não desaparece junto com uma pessoa só.</p>`,
    },
    fi: {
      q: 'Mitä tapahtuu, jos lopetatte?',
      a: `<p>Lähdekoodi on julkinen ja luettavissa:
<a href="https://github.com/ChulioZ/spielwirbel" rel="noopener">github.com/ChulioZ/spielwirbel</a>.
Sitä saa pitää omalla palvelimella ei-kaupallisiin tarkoituksiin — se joka
haluaa, voi siis pitää Spielwirbelin pystyssä itse.</p>
<p>Se ei ole lupaus siitä, että palvelu pyörii ikuisesti. Se on lupaus siitä,
ettei se katoa yhden ihmisen mukana.</p>`,
    },
    ko: {
      q: '운영을 그만두면 어떻게 되나요?',
      a: `<p>소스 코드는 공개되어 있고 누구나 읽을 수 있습니다:
<a href="https://github.com/ChulioZ/spielwirbel" rel="noopener">github.com/ChulioZ/spielwirbel</a>.
비영리 목적이라면 직접 호스팅할 수 있으므로, 원하는 사람은 자기 서버에서 Spielwirbel을
계속 운영할 수 있습니다.</p>
<p>이는 서비스가 영원히 돌아간다는 약속은 아닙니다. 한 사람과 함께 사라지지는 않는다는
약속입니다.</p>`,
    },
  },
];

// The questions this instance can answer honestly, in reading order.
function activeQuestions() {
  return QUESTIONS.filter((q) => !q.gate || q.gate());
}

// One question. The id is suffixed per language because BOTH halves render the
// same question list into one document — without the suffix every id appears
// twice, which is invalid HTML and makes `#faq-app` ambiguous as an anchor. The
// German half keeps the bare id so it stays the stable, linkable one.
function renderSection(q, lang) {
  const { q: question, a: answer } = q[lang];
  // The `-en` suffix existed only because two halves shared ONE document. With
  // one language per page the bare id is unique again — and the same in every
  // language, so `#faq-app` is linkable from any of them (#1088).
  const id = `faq-${q.id}`;
  return `
<section id="${id}" class="qa">
  <h2>${question}</h2>
  ${answer}
</section>`;
}

/* --------------------------------- the page -------------------------------- */

// The legal links in the foot line share the legal gate — those routes 404
// while the identity is unconfigured, so linking them would be a dead end (the
// same all-or-nothing condition the site footer applies via /api/config).
/* The page chrome, per language (#1088). Not i18n keys: the SPA's lang/*.js are
   browser scripts with no module.exports, and this is a server-rendered document
   — so the strings live beside the answers they wrap, exactly as they did when
   there were two of them.

   `note` is the one-line "German is authoritative" statement. It survives the
   move from two halves to nine pages because it is still true: every translation
   is made FROM the German, which stays the reference text. What went with the
   halves is the phrase "like the legal pages" — the FAQ carries no legal weight,
   and borrowing that framing overstated what this page is. */
const CHROME = {
  de: { title: 'Häufige Fragen', back: '← Zurück zu Spielwirbel',
    desc: 'Antworten auf die häufigsten Fragen zu Spielwirbel: Konten, Kosten, Daten und App-Installation.',
    intro: 'Was Leute vor der Anmeldung am häufigsten wissen wollen — und was danach noch aufkommt.',
    note: null },
  en: { title: 'Frequently asked questions', back: '← Back to Spielwirbel',
    desc: 'Answers to the most common questions about Spielwirbel: accounts, cost, data and installing the app.',
    intro: 'What people most want to know before signing up — and what comes up afterwards.',
    note: 'Translation — the German version is the authoritative one.' },
  es: { title: 'Preguntas frecuentes', back: '← Volver a Spielwirbel',
    desc: 'Respuestas a las preguntas más habituales sobre Spielwirbel: cuentas, coste, datos e instalación de la app.',
    intro: 'Lo que la gente más quiere saber antes de registrarse — y lo que surge después.',
    note: 'Traducción — la versión alemana es la vinculante.' },
  fr: { title: 'Questions fréquentes', back: '← Retour à Spielwirbel',
    desc: 'Éponses aux questions les plus fréquentes sur Spielwirbel : comptes, coût, données et installation de l’app.',
    intro: 'Ce que les gens veulent surtout savoir avant de s’inscrire — et ce qui vient ensuite.',
    note: 'Traduction — la version allemande fait foi.' },
  it: { title: 'Domande frequenti', back: '← Torna a Spielwirbel',
    desc: 'Risposte alle domande più frequenti su Spielwirbel: account, costi, dati e installazione dell’app.',
    intro: 'Quello che le persone vogliono sapere prima di registrarsi — e quello che viene dopo.',
    note: 'Traduzione — fa fede la versione tedesca.' },
  nl: { title: 'Veelgestelde vragen', back: '← Terug naar Spielwirbel',
    desc: 'Antwoorden op de meestgestelde vragen over Spielwirbel: accounts, kosten, gegevens en de app installeren.',
    intro: 'Wat mensen het liefst willen weten vóór ze zich aanmelden — en wat daarna nog opkomt.',
    note: 'Vertaling — de Duitse versie is de bindende.' },
  pt: { title: 'Perguntas frequentes', back: '← Voltar ao Spielwirbel',
    desc: 'Respostas às perguntas mais comuns sobre o Spielwirbel: contas, custo, dados e instalação do app.',
    intro: 'O que as pessoas mais querem saber antes de se cadastrar — e o que aparece depois.',
    note: 'Tradução — a versão alemã é a que vale.' },
  fi: { title: 'Usein kysytyt kysymykset', back: '← Takaisin Spielwirbeliin',
    desc: 'Vastauksia yleisimpiin Spielwirbeliä koskeviin kysymyksiin: tilit, hinta, tiedot ja sovelluksen asennus.',
    intro: 'Mitä ihmiset haluavat tietää ennen rekisteröitymistä — ja mitä sen jälkeen tulee vastaan.',
    note: 'Käännös — saksankielinen versio on sitova.' },
  ko: { title: '자주 묻는 질문', back: '← Spielwirbel로 돌아가기',
    desc: 'Spielwirbel에 관해 가장 많이 묻는 질문에 대한 답변: 계정, 비용, 데이터, 앱 설치.',
    intro: '가입 전에 가장 궁금해하는 것들 — 그리고 가입 후에 나오는 질문들.',
    note: '번역본입니다. 독일어판이 기준입니다.' },
};

// The language row: every OTHER shipped language as a link, the current one as
// plain text. Native labels come from public/js/locales.js — a backend file
// requiring out of public/js/ is the deliberate shape here
// (.claude/rules/shared-constants-across-the-stack.md), and it is what keeps a
// tenth language from needing a second list.
function langRow(lang) {
  const items = SUPPORTED_LOCALES.map((code) => (code === lang
    ? `<strong>${LOCALE_LABELS[code]}</strong>`
    : `<a href="/faq?lang=${code}" hreflang="${code}">${LOCALE_LABELS[code]}</a>`));
  return `<nav class="langs" aria-label="Sprache / Language">${items.join(' · ')}</nav>`;
}

/* `hreflang` alternates for all nine plus `x-default`, and a canonical that
   points at THIS page rather than at the German one.

   The decision the issue left open: a per-language canonical, not a single one.
   `?lang=xx` pages are genuinely different documents with different text, so
   collapsing them onto one canonical asks a crawler to drop eight of them — the
   opposite of the point. `x-default` is the German page, which is what a visitor
   with no matching Accept-Language gets. */
function headLinks(lang) {
  const canonical = lang === 'de'
    ? 'https://spielwirbel.app/faq'
    : `https://spielwirbel.app/faq?lang=${lang}`;
  const alts = SUPPORTED_LOCALES.map((code) => {
    const href = code === 'de' ? 'https://spielwirbel.app/faq' : `https://spielwirbel.app/faq?lang=${code}`;
    return `  <link rel="alternate" hreflang="${code}" href="${href}" />`;
  });
  alts.push('  <link rel="alternate" hreflang="x-default" href="https://spielwirbel.app/faq" />');
  return `  <link rel="canonical" href="${canonical}" />
${alts.join('\n')}`;
}

function footLinks(lang) {
  const back = CHROME[lang].back;
  if (!legal.legalConfigured()) return `<p class="foot"><a href="/">${back}</a></p>`;
  return `<p class="foot"><a href="/">${back}</a>
· <a href="/impressum">Impressum</a>
· <a href="/datenschutz">Datenschutz</a>
· <a href="/nutzungsbedingungen">Nutzungsbedingungen</a>
· <a href="/kontakt.html">Kontakt</a></p>`;
}

/*
 * The whole document. The CSS is written INLINE in this template rather than
 * built from a `const` above, and that is load-bearing rather than a style
 * choice: test/standalone-page-brand.test.js reads this file as TEXT and pulls
 * the rules out of `<style>…</style>`. Hoist the CSS into a constant and the tag
 * contains an interpolation instead of declarations, so the test's "no palette
 * hex outside the :root copy" assertion scans an empty string and passes
 * vacuously — the exact failure .claude/rules/break-the-code-on-purpose.md is
 * about. Verified by hoisting it on purpose and watching that assertion stay
 * green over a stray hardcoded colour.
 *
 * The design tokens themselves are COPIED from public/styles.css, exactly as
 * public/kontakt.html copies them and for the same reason: linking the real
 * stylesheet would drag the whole SPA sheet — including its `body` and `.card`
 * rules and its per-round :root theme — onto a page that has no round context
 * and must render for a logged-out visitor. That test walks the copy and fails
 * if any value drifts; it is the licence for the duplication
 * (.claude/rules/shared-constants-across-the-stack.md).
 */
/* ONE language per page (#1088). It rendered a German half above an English one
   in a single document, which is the shape that does not survive nine locales:
   stacking them all would put eight screens of other people's languages above
   the reader's own. An explicit `?lang=` wins, then Accept-Language, then German
   — resolved in lib/routes/faq.js, which passes the answer here.

   `lang` is trusted to be a shipped code: the route resolves it against
   SUPPORTED_LOCALES before calling, so an unknown one never reaches this
   function. The `|| 'de'` is the belt — a direct caller (a test, a future route)
   that hands over nothing still renders the reference language rather than
   throwing on `CHROME[undefined]`. */
function renderFaq(lang) {
  const loc = CHROME[lang] ? lang : 'de';
  const chrome = CHROME[loc];
  const body = activeQuestions().map((q) => renderSection(q, loc)).join('\n');

  return `<!DOCTYPE html>
<html lang="${localeTag(loc)}" data-design="${FACE_DESIGN}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${chrome.title} · Spielwirbel</title>
  <meta name="description" content="${chrome.desc}" />
  <link rel="manifest" href="/manifest.webmanifest" />
  <!-- Matches manifest.webmanifest's theme_color, like index.html and
       login.html: every page linking the manifest is a PWA install surface, and
       a differing value tints the app chrome differently depending on which page
       the install started from (#595). -->
  <meta name="theme-color" content="#c2410c" />
  <link rel="icon" href="/icons/tisch/favicon-32.png" sizes="32x32" type="image/png" />
  <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
${headLinks(loc)}
  <style>
    :root {
      --page-bg: #f4f1ea;
      --brand: #c2410c;
      --surface: #ffffff;
      --ink: #2b2620;
      --ink-soft: #6b6358;
      /* --shade names the direction the neutrals below travel away from the
         page (#904). These pages are always light, so it is always #000 here —
         it is copied along because test/standalone-page-brand.test.js compares
         the token TEXT, and a page that spelled the endpoint out would read as
         drift the moment styles.css retunes the direction. */
      --shade: #000;
      --line: color-mix(in oklab, var(--page-bg), var(--shade) 7%);
      --sunken: color-mix(in oklab, var(--page-bg), var(--shade) 4%);
      --brand-strong: color-mix(in oklab, var(--brand), var(--shade) 13%);
      --page-glow: color-mix(in oklab, var(--brand) 7%, transparent);
      --radius-lg: 18px;
      --shadow-2: 0 2px 8px rgba(0, 0, 0, 0.08), 0 8px 24px rgba(0, 0, 0, 0.06);
      --font: "Nunito", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      --font-display-std: "Baloo 2", "Nunito", -apple-system, BlinkMacSystemFont, sans-serif;
      --font-display: var(--font-display-std);
    }
    /* DER TISCH AS THE FACE (#1198). A second copy, of Der Tisch's tokens this
       time, applied only when <html data-design="tisch"> — which renderFaq
       stamps from FACE_DESIGN (public/js/designs.js) — the face since the flip
       (#1202); with a Klassisch face the page is exactly the one above. Every value is
       Der Tisch's own resolved token (the registry's page/accent, then
       css/designs/tisch.css, then styles.css's dark block), pinned by
       test/standalone-page-brand.test.js, which also requires this block to
       redeclare every name the Klassisch copy declares, so no Klassisch value
       leaks through. */
    :root[data-design="tisch"] {
      --page-bg: #3b2a12;
      --brand: #d9a951;
      --surface: #4a3423;
      --ink: #f6ecd8;
      --ink-soft: #e8d0aa;
      --shade: #fff;
      --line: color-mix(in oklab, var(--page-bg), var(--shade) 21%);
      --sunken: color-mix(in oklab, var(--page-bg), var(--shade) 19%);
      --brand-strong: color-mix(in oklab, var(--brand), var(--shade) 13%);
      --page-glow: color-mix(in oklab, var(--brand) 7%, transparent);
      --radius-lg: 6px;
      --shadow-2: 0 6px 14px var(--cast-soft), 0 1px 2px var(--cast);
      --font: "Manrope", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      --font-display-std: "Baloo 2", "Nunito", -apple-system, BlinkMacSystemFont, sans-serif;
      --font-display: "Bricolage Grotesque", "Manrope", -apple-system, BlinkMacSystemFont, sans-serif;
      --radius-sm: 3px;
      --radius-md: 4px;
      --on-accent: #2a1a08;
      --paper: #f8f3e7;
      --paper-raised: #efe7d5;
      --paper-ink: #2f2620;
      --paper-ink-soft: #4a4038;
      --paper-edge: #8d6436;
      --gold-deep: #d9a951;
      --gold-edge: #9a6d2b;
      --brass-hi: #f6d795;
      --accent-deep: #ab3c22;
      --cast: rgba(0, 0, 0, 0.35);
      --cast-soft: rgba(0, 0, 0, 0.30);
      --cast-deep: rgba(0, 0, 0, 0.45);
    }
    /* Only the weights this page uses. Same self-hosted files as the SPA — no
       new origin, so the CSP is untouched, and the build copies fonts through
       unhashed so these paths hold in dist/ too. */
    @font-face { font-family: 'Nunito'; font-style: normal; font-weight: 400; font-display: swap; src: url('/fonts/nunito-latin-400-normal.woff2') format('woff2'); }
    @font-face { font-family: 'Nunito'; font-style: normal; font-weight: 600; font-display: swap; src: url('/fonts/nunito-latin-600-normal.woff2') format('woff2'); }
    @font-face { font-family: 'Baloo 2'; font-style: normal; font-weight: 700; font-display: swap; src: url('/fonts/baloo-2-latin-700-normal.woff2') format('woff2'); }
    /* Der Tisch's two faces (#1198), for the face block below. Declared always,
       fetched only when a rule actually uses them — so under Klassisch not one
       of these five files is downloaded. */
    @font-face { font-family: 'Manrope'; font-style: normal; font-weight: 500; font-display: swap; src: url('/fonts/manrope-latin-500-normal.woff2') format('woff2'); }
    @font-face { font-family: 'Manrope'; font-style: normal; font-weight: 600; font-display: swap; src: url('/fonts/manrope-latin-600-normal.woff2') format('woff2'); }
    @font-face { font-family: 'Manrope'; font-style: normal; font-weight: 700; font-display: swap; src: url('/fonts/manrope-latin-700-normal.woff2') format('woff2'); }
    @font-face { font-family: 'Bricolage Grotesque'; font-style: normal; font-weight: 700; font-display: swap; src: url('/fonts/bricolage-grotesque-latin-700-normal.woff2') format('woff2'); }
    @font-face { font-family: 'Bricolage Grotesque'; font-style: normal; font-weight: 800; font-display: swap; src: url('/fonts/bricolage-grotesque-latin-800-normal.woff2') format('woff2'); }

    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      /* The app's backdrop: a soft accent glow falling from the top over a
         barely-there paper grain (the \`body\` rule in public/styles.css). */
      background-color: var(--page-bg);
      background-image:
        radial-gradient(120% 70% at 50% 0%, var(--page-glow), transparent 70%),
        url("data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='180'%20height='180'%3E%3Cfilter%20id='g'%20x='0'%20y='0'%20width='100%25'%20height='100%25'%3E%3CfeTurbulence%20type='fractalNoise'%20baseFrequency='0.9'%20numOctaves='2'%20seed='7'%20stitchTiles='stitch'/%3E%3CfeColorMatrix%20type='matrix'%20values='0%200%200%200%200%200%200%200%200%200%200%200%200%200%200%200%200%200%200.06%200'/%3E%3C/filter%3E%3Crect%20width='100%25'%20height='100%25'%20filter='url(%23g)'/%3E%3C/svg%3E");
      background-attachment: fixed;
      color: var(--ink);
      font-family: var(--font);
      line-height: 1.6;
      -webkit-font-smoothing: antialiased;
      padding: 2rem 1.5rem 4rem;
    }
    .card {
      width: 100%;
      max-width: 680px;
      margin: 0 auto;
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: var(--radius-lg);
      padding: 2rem 1.75rem;
      box-shadow: var(--shadow-2);
    }
    .brand { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 1.25rem; }
    .brand img { display: block; width: 32px; height: 32px; border-radius: 9px; }
    .brand span { font-family: var(--font-display); font-weight: 700; font-size: 1.15rem; color: var(--brand); }
    h1 { font-family: var(--font-display); font-size: 1.6rem; font-weight: 700; margin: 0 0 0.4rem; }
    .intro { font-size: 0.92rem; color: var(--ink-soft); margin: 0 0 2rem; }
    /* The language row (#1088): every other shipped language, one line, wrapping
       on a phone. Script-free like the rest of the page — nine plain links. */
    .langs { font-size: 0.9rem; color: var(--ink-soft); margin: 0 0 1.4rem; line-height: 1.9; }
    .langs a { color: var(--brand-strong); }
    .lang-note { background: var(--sunken); border-radius: 12px; padding: 0.7rem 1rem; font-size: 0.9rem; margin: 0 0 2rem; }
    /* One question. The accent rule on the left is the app's own "highlight"
       treatment, so the page reads as the same product. */
    .qa { border-left: 3px solid var(--line); padding-left: 1.1rem; margin: 0 0 1.9rem; }
    .qa h2 { font-family: var(--font-display); font-size: 1.1rem; font-weight: 700; margin: 0 0 0.5rem; color: var(--brand); }
    .qa p { margin: 0 0 0.7rem; font-size: 0.97rem; }
    .qa p:last-child { margin-bottom: 0; }
    a { color: var(--brand-strong); }
    hr.split { margin: 3rem 0; border: 0; border-top: 2px solid var(--line); }
    .foot { margin-top: 2.5rem; text-align: center; font-size: 0.88rem; color: var(--ink-soft); }
    .foot a { color: var(--ink-soft); }
    /* ---- Der Tisch (#1198, T12.2) ----
       „Eine Spalte Papier": the page is the walnut table and the answers are
       printed on a paper card laid on it. The card RE-POINTS the tokens at the
       paper family, the way tisch.css does for every overlay, so every rule
       above follows without a second copy of itself. Brass is not a colour on
       paper (1.9:1), so links and headings take the paper inks instead —
       --accent-deep for a link (5.58:1 on paper), --paper-ink for a question.
       NOT built from the sheet: the margin navigation and the glossary block.
       Der Tisch renames nothing, so it has no glossary (#1198), and the
       margin nav would be new markup, not paint. */
    :root[data-design="tisch"] body {
      background-image:
        repeating-linear-gradient(180deg, var(--page-glow) 0 2px, transparent 2px 7px);
    }
    :root[data-design="tisch"] .card {
      --surface: var(--paper);
      --ink: var(--paper-ink);
      --ink-soft: var(--paper-ink-soft);
      --line: var(--paper-edge);
      --sunken: var(--paper-raised);
      --brand-strong: var(--accent-deep);
      background: linear-gradient(180deg, var(--paper), var(--paper-raised));
      color: var(--ink);
      border-color: var(--gold-edge);
      box-shadow: 0 14px 30px var(--cast-deep);
    }
    /* The wordmark on the brass plate, as the landing prints it. */
    :root[data-design="tisch"] .brand span {
      padding: 4px 10px;
      border: 1px solid var(--gold-edge);
      border-radius: var(--radius-sm);
      background: linear-gradient(180deg, var(--brass-hi), var(--gold-deep));
      color: var(--on-accent);
      font-weight: 800;
      font-size: 0.95rem;
      letter-spacing: .14em;
      text-transform: uppercase;
    }
    :root[data-design="tisch"] h1 { font-weight: 800; font-size: 1.85rem; }
    :root[data-design="tisch"] .qa { border-left-color: var(--gold-deep); }
    :root[data-design="tisch"] .qa h2 { color: var(--ink); font-weight: 800; }
    :root[data-design="tisch"] .qa p { color: var(--ink-soft); font-weight: 500; }
    /* Review finding A7 on the footer links: a 24px target, through the box
       rather than the type, so nothing moves on the line. */
    :root[data-design="tisch"] .foot a { display: inline-block; min-height: 24px; line-height: 24px; }
  </style>
</head>
<body>
  <main class="card">
    <div class="brand">
      <img src="/icons/tisch/icon-192.png" alt="" width="32" height="32" />
      <span>Spielwirbel</span>
    </div>
    <h1>${chrome.title}</h1>
    ${langRow(loc)}
    <p class="intro">${chrome.intro}</p>
${chrome.note ? `    <p class="lang-note">${chrome.note}</p>` : ''}
${body}
${footLinks(loc)}
  </main>
</body>
</html>`;
}

module.exports = { renderFaq, QUESTIONS, activeQuestions, REPO_URL };
