---
paths:
  - "public/js/views-friends.js"
  - "public/js/views-round-actions.js"
  - "public/js/views-auth.js"
  - "public/js/views-account.js"
---

# `autocomplete="off"` does NOT stop Safari AutoFill — the id and the form shape do

Both username fields that name *another* account — the add-friend row on
`/freunde` and the invite sheet's field — shipped with `autocomplete="off"` from
the start, and Safari offered saved spielwirbel.app logins on both anyway
(observed 2026-09-13, macOS Safari + iCloud Keychain, #1077).

WebKit treats `off` as advisory and **ignores it outright** for anything its
heuristics read as a login form. Those heuristics do not look at the attribute at
all; they look at:

- the `id` and `name` — `friendUser`, `inviteUser`: both contain *user*;
- the visible label and placeholder — "Nutzername" / "Username";
- the **form shape** — a `<form>` with exactly one text input and a submit
  button is a username-first login form as far as Safari is concerned, which is
  precisely what the add-friend row is.

## What to do

**Name the field for what it holds, never for the credential it resembles.**
`friendHandle` / `inviteHandle`, and no `name` attribute at all (nothing here
submits natively, so none is needed and one only feeds the heuristic). Keep
`autocomplete="off"` — Chrome and Firefox do honour it; it is simply not
sufficient on its own.

**Add the three manager opt-outs on any field that names a person but is not a
credential.** They are free, they do nothing for Safari, and they stop the
identical offer in the extensions:

```html
data-1p-ignore data-lpignore="true" data-bwignore
```

**Do not reach for a credential `autocomplete` token to suppress the offer.**
`username` / `new-password` on a non-credential field makes a manager *store* the
handle as the account's username and autofill it into the login box next visit,
over whichever identifier the person actually logs in with — the reasoning already
written above `#regUser` in `views-auth.js`, which is why that field says
`nickname`. That field is a **real** credential field and must stay visible to
managers; don't sweep all three alike.

**The escalation, if the offer survives, is `type="search"`** — Safari does not
offer credentials for a search field, and "find the account to add" is defensible
semantics. It was not shipped in #1077 because it is the only mitigation with
*visible* consequences: WebKit's search decoration and cancel button have to be
neutralised in `styles.css` (`-webkit-appearance: none`,
`::-webkit-search-cancel-button`, `::-webkit-search-decoration`) for the field to
keep the `.input` look, on iOS as well as macOS and in the dark designs. The
attribute-only mitigations shipped first for that reason, not because they were
measured sufficient.

## Why this cannot be verified here

The Browser pane is Chromium
(`.claude/rules/browser-pane-is-chromium-only.md`), and a headless `WKWebView`
has no Keychain, so **nothing in this repo can observe the offer**. The only
verification is real Safari on macOS and iOS with a saved login for the origin —
i.e. the operator, after a deploy. Treat a claim that the AutoFill offer is gone
as unverified until that happens.

What *is* guarded is that the mitigations stay applied:
`test/credential-autofill.test.js` renders both views in jsdom and asserts the
id matches no credential word, no `name` lands on either input, no credential
`autocomplete` token appears, and all three opt-outs are present — plus that the
accessible name survives and the invite field still takes focus on open. That is
the part a later edit would quietly undo; it is not evidence the offer stopped.

**Related:** `.claude/rules/browser-pane-is-chromium-only.md` (why the check
cannot run here), `.claude/rules/native-button-vs-focusable-span.md` and
`.claude/rules/label-rows-lose-to-field-label.md` (the other two rules about what
a form control's markup promises), `public/js/views-auth.js` above `#regUser`
(the neighbouring precedent: the one field here that *is* a credential).
