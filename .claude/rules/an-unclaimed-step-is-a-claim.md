---
paths:
  - "public/js/views-pokale.js"
  - "public/js/podium.js"
  - "public/js/win-score.js"
  - "public/js/ranking.js"
  - "test/podium-ranks.test.js"
  - "test/pokale-win-score-view.test.js"
---
# An unclaimed slot in a ranked visual is itself a CLAIM — never let a hidden threshold create one

Who holds a place and who stands on the stage are two questions, and only the
first may consult the number. #895 filtered the podium on the Siegwertung —
first „above chance", then „not below chance" — and both shipped. Live family
use killed it in a day: one member on rank 1, **ranks 2 and 3 empty**, everyone
else named below the stage with nothing on screen saying why they were not on
it.

That is worse than it sounds, because **an unclaimed step is a claim**. The
geometry says „nobody stands here"; a reader who can see four names underneath
concludes the feature is broken, and no wording can fix it, because the rule
doing the excluding is a number they cannot see. „Being fourth", by contrast,
explains itself and needs no copy at all.

**So the stage is the top three PLACES, full stop**, and a member with a
negative score stands if they are in them — the operator's call, and the right
one: seeing yourself on the podium on −1,0 beats seeing the places unclaimed.
The one exclusion left is a member with **no record at all** (no wins, no
losses, took part in no session that had a winner): they score exactly 0 on an
empty sum, which would rank them above everyone who played and lost.

The only empty step left is a **tie consuming the place** — two members on 2nd
means there is no 3rd, so the painted riser is a true statement about the
ranking. Keep that distinction: a riser may say „nobody is here", never „someone
is here but we filtered them out".

## Why it took live use to find

Every check passed. The stage rendered, the arithmetic was right, the tests were
green — and two of them (`only members above chance stand`, then `nobody below
chance stands`) actively *asserted* the defect, because they were written from
the same wrong premise as the code. A spec cannot tell you that a rule the user
can neither see nor infer is the wrong rule; only somebody looking at their own
round can.

The tell to look for before shipping: **can a reader state the rule from the
screen alone?** „I am fourth and there are three steps" — yes. „My win score is
below zero" — no, that number is not on the stage they were excluded from. A
rule the UI cannot state is a rule the UI should not enforce.

**Related:** `.claude/rules/rank-encodings-must-not-be-growable-by-ties.md` (the
geometry this splits from — height, ties, and the crossover),
`.claude/rules/redefining-a-measure-invalidates-its-fixtures.md` (the fixture
padding this threshold forced, and why an elaborate fixture is a finding).
