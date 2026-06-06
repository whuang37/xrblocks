# findings: what works, what didn't

a running log of what we've learned trying to build a skill-eval for xrblocks. updated as we go.

## v1: replay merged PRs as the benchmark

idea: take recent merged PRs, materialize each as `prompt + base_sha + golden.diff`. agent runs at the base commit, output diff is scored against the golden one.

built `evals/fetch_prs.py`, `score.py`, `summarize.py`, `setup_worktree.sh`. seed set: 6 mid-size merged PRs (`#325 #326 #328 #329 #330 #335`). end-to-end verified: golden-as-agent → 1.0, empty-as-agent → 0.0.

ran task #335 ("fix interactions in netblocks sample") with gemini-cli, with and without 13 xb-* skills installed at user scope. **identical results both modes**: jaccard 0.40, recall 0.50, line_sim ~0.6.

read the in-repo `skills/README.md` and realized the eval was miscalibrated. there are two doc surfaces serving different audiences:

- `skills/xb-*/SKILL.md`: agent helping a USER build an app with xrblocks
- `AGENTS.md` + `CONTEXT.md` + `src/SKILL.md` + `src/addons/*/SKILL.md`: agent working AS A CONTRIBUTOR to the xrblocks repo

merged PRs are contributor work. xb-* skills are about user-prototyping. so loading xb-* for a PR-replay task doesn't move the needle, as expected.

## v2: prototyping tasks via gemini-cli

idea: handcrafted "build an X with xrblocks" prompts in a clean template, score by import / api / parse / forbidden-pattern checks.

built `evals/prototypes/tasks/<id>/{prompt.md, spec.json}` + `runners/run_prototype.sh` + `score_proto.py`. ran one task (`netblocks-presence`) with and without `xb-netblocks` installed.

**both modes scored 1.0**. compared the agent's output files byte-for-byte: **identical** (2581 bytes, no diff). gemini converged on the same code with or without the skill, because:

- the task was unambiguous enough that the skill content didn't matter
- gemini-cli also gives the agent filesystem access to the workspace, but in this case the workspace was a clean template, so that wasn't the leak

binary-import-and-api scoring has a ceiling effect on easy tasks. need either harder/more ambiguous prompts, or a finer-grained signal.

## v3: gem-faithful API eval (in progress)

real production target isn't gemini-cli. it's the **Gemini Canvas Gem "XR Blocks for Gemini Canvas v0.14.1"**, which:

- has skill content baked into its system prompt
- runs in Canvas mode (collaborative code canvas, no shell access)
- has no filesystem visibility into the xrblocks repo
- targets Pro for serious generation

to mirror this with the Gemini API:

- use `gemini-2.5-pro` directly via `google-genai`
- system prompt = concatenated xb-* SKILL.md content (or empty for the without-skill arm)
- user message = the prototyping prompt
- model must produce a complete `main.js` from scratch with no filesystem access
- extract the JS from the response, drop it into the workspace, score with the existing `score_proto.py`

pivoting next. installing `google-genai`, then writing `evals/prototypes/runners/run_gem_api.py`.

## meta-finding

eval design is the work, not just the harness. each iteration revealed an assumption that was wrong (contributor vs prototyping audience, cli vs canvas deployment, easy-task ceiling). this is the kind of thing that you can't catch in a design doc, only by running it once and looking at the output.

## v3 first results: it works

ran `netblocks-presence` against `gemini-2.5-pro` via the API, with skill in the system prompt and without.

| metric | with-skill | without-skill |
|--------|-----------:|--------------:|
| composite | **1.0** | **0.5** |
| import_match | 1.0 | 0.0 |
| api_match | 1.0 | 0.0 |
| forbidden_clean | 1.0 | 1.0 |
| parse_ok | 1.0 | 1.0 |
| prompt tokens | 4786 | 165 |

without the skill, gemini hallucinated an entirely fake xrblocks api:

```js
import { xr_scene, xr_room, xr_camera, xr_avatar, xr_head, xr_sphere }
  from 'https://cdn.jsdelivr.net/npm/xr-blocks@0.2.0/xr-blocks.js';
// fake jsx-style elements, fake package name (should be `xrblocks`)
// fake event system ('user-joined'), none of it exists
```

with the skill, it correctly imported from `xrblocks/addons/netblocks`, called `enableNet()`, `joinRoom()`, used `BroadcastChannelTransport` for the local-dev transport. exactly what the skill description promises.

this is the first time we've gotten a non-zero delta between the two modes. the binary import/api scorer is enough signal at this skill-rich-vs-empty extreme. for finer-grained iteration (e.g. comparing two versions of the same skill) we'd need an llm-as-judge.

next: expand the task set, run hands/uiblocks/ai etc, see if the pattern holds across skills.

## v3 full sweep (4 tasks, gemini-2.5-pro, n=8)

| task | skill | with-skill | without-skill | delta |
|------|-------|-----------:|--------------:|------:|
| ai-describe-camera | xb-ai | 1.00 | 0.81 | +0.19 |
| hands-pinch-spawn | xb-hands | 1.00 | 0.75 | +0.25 |
| netblocks-presence | xb-netblocks | 1.00 | 0.50 | **+0.50** |
| ui-button-hud | xb-ui | 1.00 | 0.75 | +0.25 |
| **avg** | | **1.00** | **0.70** | **+0.30** |

every task: with-skill scored 1.0. without-skill ranged from 0.50 to 0.81. the gap is biggest where the api surface is least googleable. xb-netblocks (bespoke multiplayer abstraction) had the largest delta because gemini has no priors on `enableNet()`, `NetObject`, `BroadcastChannelTransport`. xb-ai had the smallest because gemini knows gemini's own apis from training.

per-metric, the `api_match` column is where the signal lives. without-skill: 0.00 on three of four tasks. parse_ok and forbidden_clean were always 1.0 in both modes (model writes syntactically valid js either way; skill content doesn't push it toward hallucinated globals).

## what the eval is good for

- proves that a given xb-* skill helps gemini target the right addon when starting from scratch
- catches hallucinated api surfaces (`xr_scene`, `xr_room`, `xr_avatar` jsx-style nonsense)
- gives a per-skill numeric column that can be regressed against on skill edits

## what it doesn't catch (yet)

- whether the generated app actually runs end-to-end in a browser (would need a headless build + smoke test, ~1 day of work)
- semantic correctness beyond api names (would need llm-as-judge)
- effect on Pro vs Flash (different model, different prompt cost)
- skill ablations (comment out one section, re-run, see which lines carry the weight)
