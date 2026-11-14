# MERIT EVENT MAKER — Quality Team

The routing table. **One owner per quality area, no exceptions.** If two
agents appear to own the same thing, that is a bug in this file — report it
rather than letting them share.

The dimensions, the scoring scale and the anti-inflation rules live in
`.claude/skills/merit-quality-program/SKILL.md`. This file only says *who*.

## The table

| # | Quality area | Owner agent | Mandatory skills | Measurement owner | Final gate |
|---|---|---|---|---|---|
| 1 | Business / domain correctness | `merit-product-director` | `merit-product-contract` | `merit-product-director` | every rule in `.claude/rules/product.md` has a suite that fails on violation |
| 2 | Test discipline | `ci-quality-gate-engineer` | `merit-ci-quality-gates` | suite content: each specialist | `test:all` green; no skipped test; no lowered threshold |
| 3 | Architecture / modularity | `frontend-architect` | `merit-maintainability-hardening`, `software-architecture`, `programming-principles` | `frontend-architect` | `dependency-direction` · `boot-contract` · `offline-bundle-contract` · `plan-detection-boundary` |
| 4 | Data integrity / storage | `data-architecture-engineer` | `merit-data-integrity-hardening`, `merit-product-contract` | `data-architecture-engineer` | no silent data loss; historical immutable at the storage layer |
| 5 | Offline | `frontend-architect` | `merit-maintainability-hardening` | `frontend-architect` | `verify:offline` — both artifacts **run**, 27 checks |
| 6 | Performance | `performance-qa-engineer` | `merit-performance-hardening`, `web-performance` | `performance-qa-engineer` | median + p95 over ≥3 runs at full load |
| 7 | AI honesty | `computer-vision-engineer` | `merit-plan-intelligence` | `computer-vision-engineer` | `plan-detection-boundary` asserts `trainedModel:false` live |
| 8 | Plan intelligence reliability | `computer-vision-engineer` | `merit-plan-reliability`, `merit-plan-intelligence`, `senior-computer-vision` | `computer-vision-engineer` | zero FAIL fixtures, or each accepted in writing with an owner |
| 9 | UI / UX quality | `premium-ui-director` | `merit-ui-quality-gates`, `merit-ui-constitution`, `product-design-and-ux` | `visual-qa-reviewer` | rendered at 3 viewports × 2 languages; task completion counted |
| 10 | Accessibility | `accessibility-guardian` | `merit-accessibility-hardening`, `web-accessibility` | `accessibility-guardian` | every operator task completable by keyboard; no trap |
| 11 | Localization | `localization-guardian` | `merit-localization-hardening` | `localization-guardian` | `i18n` · `i18n-key-integrity` · hardcoded-English scan |
| 12 | Error handling / resilience | `resilience-engineer` | `merit-resilience-hardening` | `resilience-engineer` | every failure path meets DETECT/CONTAIN/INFORM/RECOVER/PRESERVE |
| 13 | Documentation | `release-quality-director` | `merit-quality-program` | `release-quality-director` | no instruction file contradicts a measurable repo fact |
| 14 | CI / automation | `ci-quality-gate-engineer` | `merit-ci-quality-gates` | `ci-quality-gate-engineer` | every RELEASE GATE can actually turn CI red |
| 15 | Security / privacy | `security-auditor` | `merit-security-hardening` | `security-auditor` | no XSS from any imported or typed string |
| 16 | Desktop readiness | `desktop-electron-engineer` | `merit-desktop-architecture`, `desktop-framework-electron` | `desktop-electron-engineer` | migration path current; **EXE gate respected** |
| 17 | Real-world validation | `release-quality-director` | `merit-quality-program` | — (needs real operators) | **NOT VERIFIED** until a real session is recorded |
| — | **Final arbitration** | `release-quality-director` | `merit-quality-program` | — | PASS / PARTIAL / BLOCKED / NOT VERIFIED |

## Agents with no quality-area ownership

These own implementation domains, not quality dimensions. They are called by
owners, and they do not produce quality scores:

| Agent | Domain |
|---|---|
| `floor-plan-engineer` | canvas interaction layer |
| `active-learning-engineer` | Teach AI lifecycle, verified examples, dataset discipline |

## Boundaries that are easy to get wrong

These pairs look overlapping and are not. Each line is a real distinction
that has caused, or would cause, two agents to touch the same thing.

- **Security vs. data integrity** — `security-auditor` owns whether a
  *hostile* payload corrupts state. `data-architecture-engineer` owns
  whether a *valid* one migrates correctly.
- **Security vs. resilience** — security owns the rejection happening;
  resilience owns the rejection being contained, informative and lossless.
- **Accessibility vs. UI direction** — `accessibility-guardian` owns that a
  dialog traps and restores focus. `premium-ui-director` owns what it looks
  like. Neither ships without the other.
- **UI owner vs. UI verifier** — area 9 has ONE owner,
  `premium-ui-director`. `visual-qa-reviewer` is the **measurement owner**:
  it produces the rendered evidence and can refuse to sign it off, but it
  does not set direction and does not score the dimension. An earlier
  version of this table listed both in the owner cell, which contradicted
  the one-owner rule this file states.
- **Accessibility vs. localization** — accessibility owns the `aria-label`
  being correct; localization owns it being Turkish.
- **AI honesty vs. plan reliability** — honesty is *never claiming a model
  exists*. Reliability is *knowing when to say UNKNOWN*. Same owner
  (`computer-vision-engineer`), two different contracts.
- **Accuracy vs. reliability** — accuracy is how many objects were found;
  reliability is how wrong we are when wrong, and whether we said so.
- **CI gates vs. suite content** — `ci-quality-gate-engineer` owns whether a
  result is honestly wired into the verdict. Each specialist owns what their
  suite asserts.
- **Performance vs. architecture** — `performance-qa-engineer` owns the
  numbers; `frontend-architect` owns the structure that produces them.

## Why no `plan-reliability-engineer` agent exists

Plan reliability is a real, distinct discipline — hence
`merit-plan-reliability`. But it is not a separate *ownership*:
`computer-vision-engineer` already owns detection and is the only agent with
the detector knowledge to judge an abstention decision. A second agent
editing the same pipeline would violate the one-owner rule in this file and
the repo's own constraint against two agents editing one central file.

What was missing was the **contract**, not the owner. The skill supplies it.

## Amending this file

Adding a quality area means adding a row with an owner. Adding an agent
without a row means it owns nothing, which is a mistake. Two rows sharing an
owner is fine; two owners sharing a row is not.
