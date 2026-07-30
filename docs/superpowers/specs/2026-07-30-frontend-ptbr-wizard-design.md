# Frontend: Portuguese translation + step-by-step app config wizard

## Context

`interface/frontend/` (the Lovable-built "Resource Tuner" console, see
`docs/superpowers/specs/2026-07-30-perftest-api-design.md`) is a working
TanStack Start + React app talking to `perftest-api`. It currently ships in
English, and its "create/edit app" screen (`AppForm.tsx`) is a single long
page with five stacked cards (Identity, Resource matrix, Load profile,
manifest.yaml, k6 script). That's fine for someone who already knows the
tool, but it front-loads a lot of unfamiliar YAML/k6/Kubernetes concepts on
a first-time user all at once.

This round covers two changes, done together since the wizard rewrite means
rewriting the form's copy from scratch anyway:

1. Translate every user-facing string in the app to Brazilian Portuguese,
   matching the tone already used in the backend (`Makefile`,
   `modules/Perftest.psm1`'s error messages).
2. Replace the single-page config editor with a step-by-step wizard, so a
   first-time user is walked through one concern at a time instead of
   facing a wall of fields.

## Goals

- Every string a user reads in the running app — page titles, buttons,
  labels, placeholders, empty states, toasts, tooltips, error messages,
  meta tags — is in Portuguese.
- Creating or editing an app is a guided, one-thing-at-a-time flow: a
  short stepper at the top, one card's worth of fields per screen,
  Voltar/Próximo to move between them, and a persistent "Salvar e sair"
  escape hatch from anywhere in the flow.
- No regressions to what already works: app CRUD, run trigger/poll/cancel,
  results viewing, prerequisite check — only the config-editing screen's
  *shape* changes, not the API calls it makes.

## Non-goals

- No i18n library, no language switcher. Portuguese is the only language;
  strings are hardcoded in place, not pulled from a translation table.
  Nothing asked for English to remain selectable, and a single-locale local
  dev tool doesn't need the machinery for more.
- No persistence of in-progress wizard drafts across a page reload
  (localStorage, etc.). Today's single-page form doesn't persist either —
  this isn't a regression, just not a new feature this round.
- No change to validation *rules* (`validateApp`'s checks stay the same) —
  only when/how they're surfaced changes.
- No change to the API contract, `lib/api.ts`, or any backend code.

## Translation

Every route and component gets its English strings replaced in place:
`__root.tsx` (header tagline, 404 page, error boundary page, meta
title/description on every route), `index.tsx` (Dashboard), the results
page, `RunBanner`, `EnvStatus`, `LogView`'s placeholder, `ChipListInput`'s
hint text, and all wizard copy (new, written directly in Portuguese rather
than translated from the old `AppForm`).

`JobStatus` values (`"starting" | "running" | "done" | "failed"`) are the
API's wire format and stay as-is in code/types — only their *displayed*
label changes, via a small lookup map in `StatusBadge`:

| value | label mostrado |
|---|---|
| starting | iniciando |
| running | executando |
| done | concluído |
| failed | falhou |

## Wizard design

### Steps

Same five categories as today's cards, plus a bookend on each end:

| # | Step | Shown when |
|---|---|---|
| 0 | **Vamos começar** — "começar do zero" vs "usar o exemplo httpbin" | create only |
| 1 | **Identidade** — nome, container | always |
| 2 | **Matriz de recursos** — memória, cpu (chip lists) | always |
| 3 | **Perfil de carga** — vus, stages | always |
| 4 | **Manifest** — manifest.yaml textarea | always |
| 5 | **Script do k6** — script.js textarea | always |
| 6 | **Revisão** — summary of every field, edit-links back to each step, Salvar | always |

Revisão shows Identidade/Recursos/Carga's fields inline (they're short),
and for Manifest/Script shows a line count + first couple of lines
(reusing `LogView`, capped height) rather than the full text — full
content is still one click away via that step's edit-link, not hidden,
just not dumped in full onto the summary screen.

Edit mode starts at step 1 (Identidade); the app already exists and its
name is locked, so there's nothing for step 0 to offer.

### Navigation

- A stepper strip across the top of the wizard card shows all of this
  session's steps; clicking any step's label jumps straight to it
  (confirmed: free navigation, not gated by validation).
- Every step has **Voltar** (hidden on the first step) and **Próximo**
  (label changes to **Ir para revisão** on the last content step).
  Neither button validates anything — they only move the `step` pointer.
- A persistent **"Salvar e sair"** button is available on every step (not
  just Revisão). Clicking it always runs `validateApp(value)` first:
  - **Valid:** calls the injected `onSave`, same as Revisão's own Salvar
    button.
  - **Invalid:** does *not* save. Jumps `step` to the earliest step that
    owns a failing field (mapping below), shows that step's inline errors,
    and a toast: "Encontramos um problema aqui — corrija para continuar."
    If other steps also have errors, the toast adds "Há mais pendências
    em outras etapas." No data entered anywhere is lost by this jump.
- The current step is reflected in the URL as a search param
  (`?passo=identidade`, using each step's key, not its index — stable if
  steps are ever reordered) so back/forward and refresh preserve position.
  Field values themselves stay in component state only (matches today's
  no-persistence behavior).

A small **"Cancelar"** link sits next to the stepper (same spot/style as
today's back-arrow link to "Apps" / the app's own page) and calls the
injected `onCancel` directly — no confirmation dialog, since nothing is
persisted until Salvar runs, so there's nothing destructive to confirm.

Field-to-step ownership, for the "jump to first invalid step" logic:

| validateApp error key | step |
|---|---|
| name, container | Identidade |
| memory, cpu | Matriz de recursos |
| vus, stages | Perfil de carga |
| manifestContent | Manifest |
| scriptContent | Script do k6 |

### Copy tone

Each step gets one short, encouraging line of context under its title
(e.g. Matriz de recursos: "Escolha os tamanhos de memória e CPU que você
quer testar — vamos rodar o k6 em cada combinação."). Step 0 explicitly
offers the httpbin example as the easy on-ramp: "Não sabe por onde
começar? Comece pelo exemplo e ajuste depois."

## Architecture

```
interface/frontend/src/components/app-wizard/
  AppWizard.tsx        # orchestrator: step state (URL-synced), nav, calls onSave
  StepIndicator.tsx     # clickable stepper strip
  StepStart.tsx          # "blank vs example" - create mode only
  StepIdentity.tsx
  StepResources.tsx
  StepLoad.tsx
  StepManifest.tsx
  StepScript.tsx
  StepReview.tsx
```

`AppForm.tsx` and `ChipListInput`'s current call sites move into
`StepResources.tsx`; `ChipListInput.tsx` itself is unchanged (just its
hint-text string translates). `emptyApp` and `validateApp` move from
`AppForm.tsx` into `AppWizard.tsx` (same exports, new home) — `AppForm.tsx`
is deleted once nothing imports it.

`AppWizard` stays a "dumb" component like today's `AppForm`: it owns step
navigation and field state, and calls two injected props —
`onSave(app: AppDetail): Promise<void>` and `onCancel(): void` — rather
than owning any TanStack Query mutation or router navigation itself. Route
components keep owning side effects:

```tsx
// apps.new.tsx (shrinks to this)
<AppWizard
  mode="create"
  initialValue={emptyApp}
  onSave={(app) => createApp.mutateAsync(app).then((created) => {
    navigate({ to: "/apps/$name", params: { name: created.name } });
  })}
  onCancel={() => navigate({ to: "/" })}
/>

// apps.$name.edit.tsx (shrinks to this)
<AppWizard
  mode="edit"
  initialValue={data}
  onSave={(app) => updateApp.mutateAsync(app).then(() => {
    navigate({ to: "/apps/$name", params: { name } });
  })}
  onCancel={() => navigate({ to: "/apps/$name", params: { name } })}
/>
```

This keeps `AppWizard` testable in isolation (no query client / router
needed to unit test step navigation and validation-jump behavior) and
keeps the existing "route owns mutations, component owns form state"
split intact.

## Testing

This is a Lovable-managed frontend project with no existing test
tooling (no Vitest/Jest config, no test files) — consistent with that,
this round doesn't introduce one either. Verification is manual: run
`make interface`, walk through create-from-example, create-from-scratch,
edit-existing, and the "Salvar e sair" validation-jump path in a browser,
confirming each against the real API.

## Rollout

Single pass, no feature flag — this is a pre-release local dev tool with
one user, so there's no compatibility surface to preserve.
