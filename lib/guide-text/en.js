'use strict';

/* The „Was spielen wir heute?" guide (#1171) in English, translated from the
   German reference (lib/guide-text/de.js). Content rules: lib/guide.js header.
   Never "evening"/"night"/"game night" (test/session-naming.test.js scans these
   values — "tonight" says when without naming the entity), never a device kind. */

module.exports = {
  title: 'What should we play tonight? How your group picks a game fast',
  description: 'A full shelf and no agreement? How groups decide what hits the table, what really matters in the choice – and a method that works in ten minutes.',
  h1: 'What should we play tonight?',
  lead: `
        <p>The shelf is full, everyone has arrived, the drinks are out – and then the discussion starts. “I don’t mind.” “Just not the long one again.” “What else have we got?” Twenty minutes later the game on the table is the one you always play, and the new boxes are still in their shrink wrap.</p>
        <p>This guide collects how gaming groups usually settle the question, what actually matters when choosing, and how to reach a decision everyone can live with in a few minutes – with or without an app.</p>`,
  sections: [
    {
      h: 'How groups decide today',
      html: `<p>Almost every group has its own habit, often without ever having agreed on it. The four most common:</p>
      <ul>
        <li><strong>Taking turns.</strong> Someone different picks each time, often whoever is hosting. That is fair over the months, but not for today: whoever dislikes the chosen game just sits it out.</li>
        <li><strong>Whoever teaches, decides.</strong> The person who knows the rules makes the call. It saves time, but it means the same person keeps shaping the whole group’s taste.</li>
        <li><strong>Chance.</strong> Roll a die, draw a slip, use a random-picker app. Nobody has to commit – but chance does not know that you only have two hours today, or that someone cannot stand a particular game.</li>
        <li><strong>A vote.</strong> A show of hands or thumbs up. Quick, but open: whoever votes last usually follows the majority, and quiet doubts get lost. A secret ballot on slips of paper is more honest, but fiddly – and it only counts what is most popular, not what someone really does not want to play.</li>
      </ul>
      <p>None of these methods is wrong. They share one problem, though: they decide before it is clear which games are even in the running today.</p>`,
    },
    {
      h: 'What really matters in the choice',
      html: `<p>Before you talk about preferences, take a quick look at the hard limits. They usually rule out most of the shelf on their own.</p>
      <ul>
        <li><strong>How many are playing?</strong> The box says “2–6”, but many games are only really good at a particular count. Picking a game that shines with four when there are five of you is less fun for everyone.</li>
        <li><strong>How much time do you have?</strong> Counted honestly, including setup and teaching. A game that promises “60–120 minutes” rarely takes only 60 with a new group.</li>
        <li><strong>How much brainpower is left?</strong> After a long week a light game often fits better than the heavy strategy game everyone is secretly looking forward to.</li>
        <li><strong>Who knows the rules?</strong> A new game needs someone to explain it and patience from everyone else. A familiar one can start right away.</li>
        <li><strong>Is there a clear no?</strong> A game one person really does not want to play is almost always the worse choice, even if everyone else likes it. A veto weighs more than a mild preference.</li>
        <li><strong>Is the box even here?</strong> If you meet at different people’s places, the game may be on the wrong shelf.</li>
      </ul>`,
    },
    {
      h: 'A method for tonight, in ten minutes',
      html: `<ol>
        <li><strong>Filter first, then talk.</strong> Strike everything that does not fit the player count, the time you have or the mood.</li>
        <li><strong>Draw a short list.</strong> Three to five games are enough; more candidates do not make the choice better, only longer. If nobody wants to commit, let chance draw – but only from what is left after filtering.</li>
        <li><strong>Everyone rates every game, on their own.</strong> A scale from 1 (“not at all”) to 5 (“absolutely”) is enough. All that matters is that nobody sees the others’ answers before everyone is done.</li>
        <li><strong>Take the veto seriously.</strong> A game with a 1 drops down the list, even if its average looks good.</li>
        <li><strong>The winner goes on the table.</strong> The game with the best rating gets played. No renegotiating.</li>
      </ol>
      <p>This works with slips of paper and a pen. It only gets tedious when you start from scratch every time – and that is exactly what Spielwirbel is for.</p>`,
    },
    {
      h: 'How Spielwirbel does it',
      html: `<p>Spielwirbel is a web app for gaming groups that takes over this method. Your group sets up its shelf once – by hand, or by searching BoardGameGeek, which brings the title, cover and player count along.</p>
      <p>When you want to play, you pick who is at the table today. Spielwirbel then draws a handful of games that fit exactly that player count. If you like, narrow it down first: by the group’s own tags and, for games linked to BoardGameGeek, by playing time, complexity and what the BoardGameGeek community recommends for that player count. If you have recorded who owns which box, games whose owners are not here today stay out.</p>
      <p>Then everyone rates the drawn games from 1 to 5 – in turn on one device that gets passed around, or on their own device through a shared link or QR code, with no account at all. The ratings stay secret until the vote is closed. Then Spielwirbel shows the ranking, and a “not at all” counts for more than its number suggests – so you end up playing what everyone actually wants to play.</p>
      <p>You record what was played and who won. With every session your group gets to know its taste a little better: which games go down well and which keep wanting back on the table.</p>`,
    },
  ],
  cta: {
    title: 'Try it yourself',
    demoText: 'The demo opens a ready-made group with games and past sessions – no e-mail, no password. It deletes itself after a while.',
    demoButton: 'Start the demo',
    openText: 'Spielwirbel runs in the browser; there is nothing to install.',
    openButton: 'Open Spielwirbel',
  },
  chrome: {
    note: 'Translation – the German version is the reference text.',
    back: '← To Spielwirbel',
    faq: 'Frequently asked questions',
    langs: 'Languages',
  },
};
