'use strict';

/*
 * The landing-screenshot SEED DATA — everything
 * scripts/capture-landing-shots.js puts into the throwaway dataset before it
 * shoots.
 *
 * Its own file because it is a flat data table: nine near-identical blocks, one
 * per shipped locale, edited by whoever adds a language and by nobody else — the
 * seam `.claude/rules/token-friendly-source-files.md` prescribes, and the shape
 * lib/demo-seed.js already has next to lib/demo.js. The capture pipeline (a
 * server, a seed pass, a CDP client, three crops) is the other half and does not
 * change when a locale is added.
 *
 * It is also what makes test/landing-shots.test.js able to `require` METADATA
 * instead of matching it out of the script's source with a regex, which is all
 * that read ever wanted.
 *
 * NOTHING HERE MAY CARRY COVER ART OR A REAL TITLE. The titles are invented and
 * no game gets an image, so every cover is the app's own coverPlaceholder()
 * gradient — a committed marketing image holding a provider's cover would be
 * re-hosting someone else's artwork on the most public page we have
 * (.claude/rules/provider-cover-hotlinking.md).
 */

/*
 * The seeds. One per locale, same SHAPE in each (12 games, 4 seats, 4 tags, 3
 * finished sessions) so every set shows the same badges and counts and a
 * difference between two locales can only be the app or the words.
 *
 * Translating the app's chrome is not translating the screenshot: an English
 * page showing a round called „Donnerstagsrunde" holding „Die Krähenbrücke" is
 * exactly the half-translated impression #457 removed. So the content is
 * localized too — round name, game titles.
 *
 * The first two games are the ones the first two finished sessions rate, in
 * that order: 4,5,4,5 and 4,4,5,4. Since
 * #850 the badge is written in the READER's notation, so the en set shows a dot
 * where the de/es/fr/it sets show a comma — a dot in a
 * non-English set now means the capture predates that change. Do NOT treat any
 * particular figure as a target: the badge is the shrunk Spielwirbel-Score since
 * #894/#928, which is expected to be retuned, so read whatever the current
 * arithmetic prints.
 *
 * THREE more games carry a score since #1090, because the `result` shot needs a
 * session with a ranking in it (RESULT_RATINGS below). They are the three whose
 * only tag is the fourth — indices 3, 7 and 11 — which is what the exclude
 * filter in seedRound selects. Every other game shows the "neu"/"new" badge. Cover gradients are derived from the
 * title (gameHue() in public/js/cover.js), so they follow the words and differ
 * between the two locales by construction — that is not a bug in the set.
 */
const RATINGS = [
  [4, 5, 4, 5], // -> Ø 4.5 on games[0]
  [4, 4, 5, 4], // -> Ø 4.3 on games[1]
];

/* The THIRD session (#1090), the one the `result` shot is taken of. It exists
 * because the two above each rate exactly ONE game — deliberately, so which
 * cards carry a Ø badge is reproducible — and a results screen holding one row
 * is not a ranking. The walkthrough's caption promises the group sees its
 * ranking, so the picture has to be one.
 *
 * One row per DRAWN game, four ratings each (one per seat), spread so the three
 * rows come out in an unmistakable order rather than within a rounding error of
 * each other. Keyed by draw order rather than by game, so the spread holds
 * whichever three games the filter leaves — see seedRound in
 * scripts/capture-landing-shots.js, where an exclude filter makes that set
 * deterministic.
 */
const RESULT_RATINGS = [
  [5, 5, 4, 5],
  [4, 3, 4, 3],
  [2, 3, 2, 1],
];

/* The default four seats. They are proper names, and the committed sets have
   always shown the same MA/JO/LE/TI avatars across the latin-script locales.

   A seed may override them, and Korean does (#1047): four German names on a
   Korean shelf are exactly the half-translated impression the per-locale seed
   exists to remove — and unlike a game title, a seat name is also read back out
   as an avatar, so it is the most visible Latin text in the picture. Keep any
   override to four names with DISTINCT leading pairs, since `initials()` shows
   the first two characters of a single-word name and a clash reads as one
   person appearing twice. Measured: two Hangul syllables are 22.5px inside the
   34px disc, against 21.2px for „MA", so they fit as they are. */
const MEMBERS = ['Marco', 'Jonas', 'Lea', 'Tim'];

/*
 * Provider metadata (#717/#724), cycled over the shelf. Without it TWO of the
 * affordances these screenshots exist to show simply do not render, because both
 * are gated on a game having something to say:
 *
 *   - the vote card's ⓘ (#724/#730) — `hasGameInfo` (public/js/game-info.js) is
 *     false for a game carrying none of these fields, by design, so a hand-typed
 *     game "looks exactly as it always did";
 *   - the Regal's „Weitere Filter" disclosure (#725) — `metadataFilterOptions`
 *     (public/js/draw-pool.js) derives the controls from stored values and drops
 *     the whole disclosure when the shelf can offer none.
 *
 * So a plain reshoot of the old seed can never depict either, however current
 * the code is: the app is right and the *seed* is what predates the features.
 * That is what #752 turned out to be — the issue asked only for a recapture.
 *
 * NUMBERS ONLY, and no `source`. Both are deliberate:
 *   - the numeric four satisfy `hasGameInfo` and give the disclosure its three
 *     controls, so categories/mechanics would add nothing visible (the ⓘ sheet
 *     is closed and the disclosure collapsed in every frame) while putting
 *     invented strings into BGG's own vocabulary. `rating` is skipped for a
 *     stronger reason: it must never reach a voting surface at all
 *     (.claude/rules/provider-info-is-a-field-set.md).
 *   - a game with no `source` is not eligible for the lazy backfill
 *     (`needsProviderInfo` short-circuits on it), so the Regal and setup screens
 *     — both backfill triggers since #736 — cannot turn a capture run into an
 *     upstream BGG request. The script stays offline by construction.
 */
const METADATA = [
  { weight: 1.8, minPlaytime: 30, maxPlaytime: 45, minAge: 8 },
  { weight: 2.6, minPlaytime: 45, maxPlaytime: 75, minAge: 10 },
  { weight: 3.4, minPlaytime: 60, maxPlaytime: 120, minAge: 12 },
  { weight: 2.1, minPlaytime: 20, maxPlaytime: 40, minAge: 8 },
];

const SEEDS = {
  de: {
    round: 'Donnerstagsrunde',
    tags: ['Brettspiel', 'Koop', 'Kennerspiel', 'Digital'],
    games: [
      'Sternenhafen', 'Hexenkessel', 'Die Krähenbrücke', 'Kartografen des Nordens',
      'Tal der Laternen', 'Obsidian Drift', 'Marktplatz von Verano', 'Rost & Regen',
      'Zunftmeister', 'Salz & Sand', 'Der letzte Zug', 'Nordlichtjagd',
    ],
  },
  en: {
    round: 'Thursday Crew',
    tags: ['Board game', 'Co-op', 'Strategy', 'Digital'],
    games: [
      'Starhaven', 'Emberkettle', 'The Crowbridge', 'Mapmakers of the North',
      'Valley of Lanterns', 'Obsidian Drift', 'Verano Market', 'Rust & Rain',
      'Guildmaster', 'Salt & Sand', 'The Last Train', 'Northern Lights',
    ],
  },
  es: {
    round: 'Los jueves',
    tags: ['Juego de mesa', 'Cooperativo', 'Estrategia', 'Digital'],
    games: [
      'Puerto Estelar', 'Brasa Negra', 'El Puente de los Cuervos', 'Cartógrafos del Norte',
      'Valle de los Faroles', 'Deriva de Obsidiana', 'Mercado de Verano', 'Óxido y Lluvia',
      'Maestro del Gremio', 'Sal y Arena', 'El Último Tren', 'Caza de Auroras',
    ],
  },
  // The second title is kept SHORT on purpose (#824): it lands where the phone
  // crop cuts, and a title wrapping to two lines pushes that cut through a card
  // title instead of through cover art.
  fr: {
    round: 'La bande du jeudi',
    tags: ['Jeu de plateau', 'Coopératif', 'Stratégie', 'Numérique'],
    games: [
      'Port Stellaire', 'Braise Noire', 'Le Pont aux Corbeaux', 'Cartographes du Nord',
      'Vallée des Lanternes', 'Dérive d’Obsidienne', 'Marché de Verano', 'Rouille et Pluie',
      'Maître de Guilde', 'Sel et Sable', 'Le Dernier Train', 'Chasse aux Aurores',
    ],
  },
  it: {
    round: 'La banda del giovedì',
    tags: ['Gioco da tavolo', 'Cooperativo', 'Strategia', 'Digitale'],
    games: [
      'Porto Stellare', 'Brace Nera', 'Il Ponte dei Corvi', 'Cartografi del Nord',
      'Valle delle Lanterne', 'Deriva d’Ossidiana', 'Mercato di Verano', 'Ruggine e Pioggia',
      'Maestro di Gilda', 'Sale e Sabbia', 'L’Ultimo Treno', 'Caccia alle Aurore',
    ],
  },
  nl: {
    round: 'De donderdagclub',
    tags: ['Bordspel', 'Coöperatief', 'Strategie', 'Digitaal'],
    games: [
      'Sterrenhaven', 'Zwarte Sintel', 'De Kraaienbrug', 'Kaartmakers van het Noorden',
      'Dal der Lantaarns', 'Obsidiaandrift', 'Markt van Verano', 'Roest en Regen',
      'Gildemeester', 'Zout en Zand', 'De Laatste Trein', 'Jacht op het Noorderlicht',
    ],
  },
  ko: {
    round: '금요일 모임',
    members: ['지민', '현우', '서연', '도윤'],
    tags: ['보드게임', '협력', '전략', '디지털'],
    games: [
      '별빛 항구', '검은 불씨', '까마귀 다리', '북방의 지도 제작자',
      '등불의 계곡', '흑요석 표류', '여름 시장', '녹과 비',
      '길드의 장인', '소금과 모래', '마지막 기차', '오로라 사냥',
    ],
  },
  fi: {
    round: 'Perjantain porukka',
    tags: ['Lautapeli', 'Yhteistyö', 'Strategia', 'Digitaalinen'],
    games: [
      'Tähtisatama', 'Musta Hiillos', 'Korppien Silta', 'Pohjolan Kartanpiirtäjät',
      'Lyhtyjen Laakso', 'Obsidiaanin Ajelehdus', 'Kesämarkkinat', 'Ruoste ja Sade',
      'Killan Mestari', 'Suola ja Hiekka', 'Viimeinen Juna', 'Revontulten Metsästys',
    ],
  },
  pt: {
    round: 'A turma de quinta',
    tags: ['Tabuleiro', 'Cooperativo', 'Estratégia', 'Digital'],
    games: [
      'Porto Estelar', 'Brasa Negra', 'A Ponte dos Corvos', 'Cartógrafos do Norte',
      'Vale das Lanternas', 'Deriva de Obsidiana', 'Mercado de Verano', 'Ferrugem e Chuva',
      'Mestre da Guilda', 'Sal e Areia', 'O Último Trem', 'Caça à Aurora',
    ],
  },
};
module.exports = { RATINGS, RESULT_RATINGS, MEMBERS, METADATA, SEEDS };
