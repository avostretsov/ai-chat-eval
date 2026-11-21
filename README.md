# ai-chat-eval

**Playwright + TypeScript harness that tests an AI chat assistant the way a QA engineer tests a store by hand:** ask a fixed set of shopper questions, check every reply against an answer key, and flag answers that are wrong, made up or inconsistent across runs. A ship/block gate fails the build on any critical failure.

Tested on two targets: a local bot with planted traps, and a real Shopify store's AI chat app. Runs at **$0** by default: the local bot and the optional judge run on a local [Ollama](https://ollama.com) model. The model, the judge and the target site are settings, not code.

![Pass-rate heatmap: topic × shopper type](docs/heatmap.png)

*One run against the local test store with three planted traps: 22 questions × 3 runs. The gate says BLOCK: the bot promised free shipping at $35 (the policy says $50) and gave out a phone number the store does not have.*

---

## What it does

1. **Opens the chat in a fresh browser context** for every question, asks it (single questions and 3 multi-turn chats such as *"…I'm in Canada though"*), and saves the reply text and a screenshot.
2. **Scores each reply against pass rules** written before the first run ([questions/pinecrest.yaml](questions/pinecrest.yaml)): required facts, forbidden claims, severity and a source link for each question.
3. **Asks every question 3 times** (stability testing) and flags questions whose verdict changes between runs.
4. **Reports** a summary a store owner can read (GO / NO-GO and the top failures in plain words), a pass-rate heatmap (topic × shopper type), severity counts, a stability list and every reply with its screenshot, plus the Playwright HTML report.
5. **Gates the release**: one critical failure in any run, and the build fails.

## Why non-deterministic replies are hard to test

The same question gets a differently worded answer every time, so `expect(reply).toBe("…")` is useless. This harness checks **facts, not wording**:

| Check | What it catches | Example |
|---|---|---|
| 1. Must contain | Required facts, after normalizing numbers and text ("fifty dollars" = "$50.00" = `$50`; "5–10" = `5-10`) | Free shipping reply must say `$50` |
| 2. Must not contain | Claims that contradict the policy (**Wrong**) or have no basis in it (**Made up**) | `$35`, `1-800-555-0199`, "match or beat the price" |
| 3. Dodge detection | "I don't have that information" when the answer is published | **Dodged** |
| 4. LLM judge *(optional)* | Rewordings that rules 1–3 can't decide | `JUDGE=ollama`: suggests a verdict for **Needs review** replies |

A reply the rules can't decide is marked **Needs review** for a person, never guessed. The judge only looks at those, and a rule verdict is never overridden. Verdicts: **Correct · Partly · Wrong · Made up · Dodged · Needs review**.

**Severity** (from the question file): **critical** = a wrong or made-up promise about money or policy (blocks the release) · **major** = dodges or contradicts a published answer · **minor** = missing detail.

## Results on the local test store (llama3.2:3b, judge off)

| | Bot with planted traps | Same bot, traps off |
|---|---|---|
| Pass rate (decided replies) | 74% (45/61) | 90% (55/61) |
| Stability (same verdict in all 3 runs) | 77% (17/22) | 73% (16/22) |
| Replies with a critical failure | 13 | 2 |
| **Gate** | **BLOCK**: 5 questions | **BLOCK**: 1 question |

**Planted traps: every time a trap fired, the harness caught it.**

| Trap planted in the bot's instructions | Fired and caught |
|---|---|
| Free-shipping threshold changed from $50 to $35 | 9 of 9 targeted replies (Wrong) |
| A made-up phone number, 1-800-555-0199 | 3 of 3 targeted replies (Made up) |
| A 15% restocking fee, only for vague shoppers | 0 of 6 targeted replies in this run. In an earlier run it fired once, on an *impatient* question instead (Made up). A 3B model follows "only when vague" loosely. |

**It also caught errors nobody planted.** The bot said *"Yes, we price match… we'll refund the difference"* (made up; the trap-free bot did it in 2 of 3 runs too), invented in-store pickup *"through partner retailers"*, and offered a Canadian shopper the US-only prepaid return label. That last one blocks even the trap-free bot: a 3B model on a laptop is not shippable, and the gate says so.

## Results on a real Shopify store (Zopi AI chat app, judge off)

The same 22 questions, rules and gate, run against a Shopify development store with a free AI chat app ([Zopi AI Chatbot](https://apps.shopify.com/zopi-ai-chat)), set up with the same products and policies as the local store. Run `2026-11-21_18-58-56_baseline`: 22 questions × 3 runs, 75 bot replies.

| | Local bot, planted traps | Local bot, traps off | **Shopify store, Zopi** |
|---|---|---|---|
| Pass rate (decided replies) | 74% (45/61) | 90% (55/61) | **89% (59/66)** |
| Stability (same verdict in all 3 runs) | 77% | 73% | **95%** |
| Replies with a critical failure | 13 | 2 | **0** |
| Needs review | 5 | 5 | **0** |
| **Gate** | **BLOCK**: 5 questions | **BLOCK**: 1 question | **SHIP** |

**Zopi made no wrong or made-up promises about money or policy, so the gate says SHIP. Its failures are dodges: it did not give answers that were published.**

| What the shopper asked | What Zopi did | Verdict |
|---|---|---|
| *"can the down jacket go in the wash?"* (3 of 3 runs) | *"I recommend checking the care label…"*, though the product page says machine washable on a gentle cycle | Dodged |
| *"zipper on my jacket broke. how do i reach you"* (3 of 3) | Never gave the support email; *"I have initiated a request to connect you with a human agent"*, on a store where nobody watches the app's inbox | Dodged |
| *"return window. now."* (1 of 3) | Only *"Please allow me a moment to retrieve the specific details"* | Dodged |

The human-agent handover is the kind of thing a launch check is for: on a real store it works only if someone staffs the inbox, and otherwise the shopper waits for no one.

Every reply the rules could not decide on the first pass (13) was read by a person: the 3 problems above became new dodge wordings, and correct wordings the rules missed (*"we do not offer price matching"*, *"between 16 and 21 inches"*) were added as alternatives. Each change is in the question file's change log; the local results and the gate's decisions on them did not change.

**What a real widget adds, and how the adapter ([src/targets/zopi.ts](src/targets/zopi.ts)) handles it:**

| Real-store problem | How the adapter handles it |
|---|---|
| Password-protected dev storefront | Enters the password from `.env` |
| Widget inside a shadow DOM | Playwright locators pierce open shadow roots |
| Replies stream in, with pauses | Done only when the typing indicator is gone **and** the text has not changed for 2 s |
| A holding message first (*"allow me a moment"*), then the answer | Waits 3 s more for a second message and joins them |
| Product cards and buttons inside replies | Reads the reply text only |
| Chat history kept per visitor | A fresh browser context for every question |
| A launcher that sends a question by itself | The test fails if the chat isn't empty before the first question |
| A free plan with a reply budget | Each run records how many bot replies it used |

These are pinned down by a widget contract test against a local copy of the widget's markup ([tests/widget/](tests/widget)), which runs in CI.

## Testing the judge before trusting it

An LLM judge is itself a model that can be wrong, so it is measured before it is trusted. [fixtures/judge/calibration.json](fixtures/judge/calibration.json) holds the 10 gray-zone replies from the runs above, each labelled by a person with a reason; `npm run judge:check` scores any judge model against them.

| Judge (local, $0) | Verdict matches the person | Pass/fail matches | False blocks |
|---|---|---|---|
| llama3.2:3b | 0 / 10 | 4 / 10 | 5 |
| qwen2.5:3b | 0 / 10 | 4 / 10 | 5 |

Both 3B models return valid JSON every time but can't apply the rubric: both marked a true *"No."* to *"ship to UK?? yes or no"* as **Wrong** (qwen's own reason: *"we do not ship to the uk"*), and both called invented pickup options **Dodged** instead of **Made up**. Five of those verdicts would have blocked a release that should not be blocked.

So the judge is **advisory by default**: its verdict is shown as a suggestion (⚖ in the report), the reply stays *Needs review*, and only the rules can block. `JUDGE_CAN_BLOCK=true` lets a judge's verdicts count, for a judge that has passed `judge:check` (for example a paid model). The rubric is in [src/judge/rubric.md](src/judge/rubric.md), answers are cached, and the judge runs at temperature 0, so results are reproducible.

## Run it

Needs Node 20+ and [Ollama](https://ollama.com/download).

```bash
ollama pull llama3.2:3b
npm install
npx playwright install chromium
cp .env.example .env
```

```bash
npm run bot          # chat with the test store at http://localhost:3000
npm run eval         # ask every question 3×, score, gate (about 6 min on a laptop CPU)
npm run report       # runs/<id>/summary.html: heatmap, stability, every reply
```

| Command | What it does |
|---|---|
| `npm run capture` | Ask the bot and save replies + screenshots to `runs/<id>/` |
| `npm run score` | Score the latest run with the current rules (no bot needed) |
| `npm run gate` | Ship/block gate on the latest run; exits non-zero on BLOCK |
| `npm run questions` | Validate the question file and print the topic × shopper grid |
| `npm run test:unit` | Unit tests: normalizing, checks 1–3, stability, the gate rule |
| `npm run golden` | The gate must block exactly the reviewed questions on recorded runs |
| `npm run judge:check` | Measure a judge model against human-labelled replies |
| `npm run test:widget` | The Shopify adapter against a local mock of the chat widget (no store, no replies spent) |
| `npm run smoke:shopify` | 3 questions × 1 run on the Shopify store (about 4 bot replies) |
| `npm run eval:shopify` | Every question 3× on the Shopify store, then the gate (about 72 bot replies) |
| `npm run report:png` | Save the heatmap image for this README |

## Provider-agnostic: everything is a setting

All settings live in `.env` ([.env.example](.env.example)) and [eval.config.ts](eval.config.ts). Switching a model never touches test code.

| Setting | Values | Default |
|---|---|---|
| `PROVIDER` / `MODEL` | `ollama` · `claude` · `openai` | `ollama` / `llama3.2:3b` |
| `JUDGE` / `JUDGE_MODEL` | `off` · `ollama` · `claude` · `openai` | `off` |
| `JUDGE_CAN_BLOCK` | `false`: judge only suggests · `true`: judge verdicts count and can block | `false` |
| `TARGET` | `local` (this repo's test store) · `shopify` (a dev store with the Zopi AI chat app) | `local` |
| `SHOPIFY_STORE_URL` / `SHOPIFY_STORE_PASSWORD` | the store (may include a path, e.g. a preview page) and its storefront password (`.env` only) | none |
| `RUN_LABEL` | a name for the run, e.g. `baseline` or `after-fixes`: added to the run folder and `results.json` | none |
| `TRAPS` | `on` · `off`: plant the three traps in the test bot | `on` |
| `REPEATS` | runs per question for stability testing | `3` |

Paid models are an optional upgrade: add `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` to `.env` (git-ignored) and change `PROVIDER` or `JUDGE`.

## CI

CI can't reach a local model, so it protects the parts that decide ship/block, using replies **recorded from real runs** ([fixtures/runs/](fixtures/runs)): type check → pass-rule validation → unit tests → **golden check** → **widget contract test**. The golden check rescores the recorded replies and fails if the gate's list of blocking questions changes in either direction, so a rule or scoring change can't make the gate weaker (or stricter) without review. The widget contract test runs the Shopify adapter against a local copy of the chat widget's markup (shadow DOM, password page, streamed replies, product cards), so a change to the adapter is checked without a store. Gate reports for both recorded runs are uploaded as artifacts.

## How it's built

```
app/                 the test store: chat page, published policy, bot prompt with traps
questions/           pass rules: 22 questions × topic × shopper type, written before the first run
src/providers/       one chat() for Ollama, Claude, OpenAI: used by the bot and the judge
src/targets/         how to open a chat and ask on each site: local page, Shopify + Zopi widget
src/scoring/         normalize → checks 1–3 → verdict; stability; the ship/block rule
src/judge/           check 4: rubric, judge call, judge:check against human labels
src/report/          summary page with the heatmap
tests/capture.spec   ask and save evidence, one fresh browser context per question and run
tests/gate.spec      one test per question: fails on any critical failure
tests/unit/          37 unit tests, no browser or model (the judge uses a fake model)
tests/widget/        the Shopify adapter against a mock of the real widget
```

Capturing and scoring are separate steps: replies are saved once and can be rescored with new rules (or the judge) without asking the bot again. Each run's `results.json` starts with a versioned `summary` (decision, blocking questions, pass rate, stability) and the run's label, so runs can be compared over time.

**Pass rules are test-first, and every change is logged.** The rules were written before the first run. When real replies showed a correct wording the rules missed (*"machine washable"*) or a made-up promise they let through (*"match or beat"*), the fix is recorded with the date and the reply that prompted it in the change log at the top of the question file.

## Limits (honest ones)

- **Keyword rules can't read context.** *"You'll receive a prepaid return label for your US orders, but for Canadian orders…"* matches the forbidden phrase "prepaid return label" in a correct sentence. That gray zone is what the judge is for, and the free local judges are not good enough to settle it (see above).
- **A 3B model on a laptop CPU** is a deliberately weak bot: good for proving the harness catches errors, not a benchmark of any product.
- **Needs review** replies are excluded from the pass rate and listed for a person.
- **The Shopify result is one baseline run of a free app on a test store** with 3 products, not a review of the app. Replies counted against the app's free plan (1,000 in total), so runs were kept small.

**Testing rule:** this harness is only pointed at chats we control or have **written permission** to test.
