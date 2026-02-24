# Product design: Defining user value

_February 2026_

## Background

I have this repo but I haven't shared it with people at large. Before I do that, I want to make sure that people can
actually profit from it. I wonder what they might want to use this for, what they will want from this in the first
place.

## Convo with a product designer friend

I talked to a product designer friend (PD) who asked the right questions. When I showed her the tool, she asked: "What
insight does this give you?" I listed the things I found interesting: when a project started, how big it is now, what
languages it uses, the production/test code ratio — basically the things I highlighted in the summary cards above the
chart.

She pushed deeper: "But why are those important? What do you learn from them?" I said: roughly how complex a project is,
how good its quality is, how fast it's moving, how big it'll be in X months.

Then she really drilled in: What about codebases that haven't been developed in a while? Can you filter dead periods?
What does it mean if a project is complex — why does that matter? How do you know code quality from test ratios — is
there even a threshold? What if growth is slow?

I realized my concrete use cases are:

1. **Understanding and celebrating my own project.** I'm curious how to think about my current project — how big is it
   really? There's a celebration aspect (yay, 100,000 lines!), and also practical value in watching how AI agents handle
   it as it grows. Maybe I'll learn that agents start struggling at 200K lines — useful info, though agents are
   improving fast.
2. **Velocity benchmarking.** Am I moving fast? Compared to similar projects, is my pace good (celebration: I'm 5x
   faster than the competitor team!) or concerning (whoa, competitor team is way ahead)?
3. **Competitive intelligence.** How big is a competing, older project? How long did it take them to get there? How fast
   are they growing now?

## Convo with an AI agent (product design perspective)

I also discussed this with an AI agent acting as a product designer. Key insights from that conversation:

### The "data vs. insight" gap

The tool currently answers **"what"** questions well (what languages, what size, what growth rate) but doesn't answer
**"so what"** questions at all. 100K lines — is that big? For a React app? For a compiler? 78% prod / 22% test — is that
healthy? Compared to what? Raw numbers without context are only meaningful to people who already carry that context in
their heads.

### My persona is one person with two hats

I'm a solo dev (or tiny team lead) who is also the business person. I want to understand my project AND tell its story
to the world. These aren't two separate audiences — it's the same person in two modes: introspective ("how am I doing?")
and performative ("look how I'm doing!").

### The AI zeitgeist angle is an unfair advantage

In 2026, the conversation everyone is having is: "What does building software look like now?" Vibe coding, AI pair
programming, solo devs shipping what used to take teams. People are grasping for ways to comprehend this shift. This
tool could be the lens through which people see and discuss this change — not just a stats dashboard. There are other
tools that show code stats, but positioning as "understand your codebase in the age of AI" is unique and timely.

I want to position myself as an AI expert and I want to use everything I'm building to honestly demonstrate this. I'm in
the field of dev tooling more than any other field. Anything that keeps me close to the AI boom and positions me as an
expert sounds great.

### The stratigraphy metaphor goes deeper than I realized

A LoC-over-time chart with language and test breakdown is a **biography of a project.** The chart records events:

- **A new language appears** — someone made a technology bet.
- **Growth rate changes** — could mean new hires, AI tools adopted, or a pivot.
- **Test code stops keeping up** — discipline is slipping, deadline pressure.
- **A language disappears** — a rewrite happened, a bet was abandoned.
- **A massive spike** — a migration, a vendor import, a code generation dump.

These are real events. The chart records them the way rock strata record volcanic eruptions and ice ages. But right now,
**the tool doesn't help anyone read them.** It's like showing someone a geological cross-section without labels.

### What should happen after pressing "Analyze"

The tool should **read the project's biography back to the user.** Not just "100K lines, 78% prod," but something like:

> _"This project started in March 2022 with just Python. Five months in, TypeScript appeared — looks like a frontend was
> added. Growth was steady at ~60 lines/day until late 2024, then jumped to 400/day. Test code kept pace the whole time
> — that's uncommon at this velocity. At 94K lines, this is similar in scope to FastAPI."_

When someone who built that project reads this, they feel **seen.** When someone reads it about a project they didn't
build, they feel **understanding.** The feeling is: "I can see the story."

### The core user

The user is a developer (or technical founder) who wants to understand, not just build. They're reflective about their
craft. They think about trajectory, not just today's code. They enter their own repo first (because the biography of
your own project is the most compelling read), then projects they're curious about — a dependency, a competitor, a
project they admire.

### AI era markers

I like the idea of adding vertical era markers on the chart — "Copilot era (Jun 2022)" and "Agentic era (~early 2025)" —
like geological era boundaries. Not "this is when YOU adopted AI" but "this is when the industry shifted." This creates
conversation: people look at their own project's curve and see whether anything changed at those boundaries. It fits the
stratigraphy metaphor perfectly. Though the exact dates are debatable (I personally started using tab completions in
2021), industry-level milestones are defensible.

## Action items

Based on all of this, I think I should:

1. **Build an interpretation layer.** This is the biggest gap. The tool shows data but doesn't help people read it. I
   should detect patterns in the data (language additions/removals, growth rate inflection points, test ratio trends)
   and narrate them in plain language. This is what makes the tool a stratigrapher, not just a chart renderer. The
   narrative can be generated from the data I already have — no external APIs needed.

2. **Add a reference dataset of well-known projects.** Pre-analyze 20–30 notable projects (React, Express, Django,
   FastAPI, SQLite, etc.) and store their summary stats. This powers contextual comparisons like "similar in scope to
   FastAPI" and makes every number meaningful through familiar reference points.

3. **Add AI era markers on the chart.** Two vertical lines — Copilot era and Agentic era — as labeled boundaries.
   Minimal implementation effort, maximum point-of-view. This alone makes every chart a conversation piece and positions
   the tool (and me) within the AI development narrative.

4. **Add an OG share card.** A templated image with a mini chart and key stats so that every shared link looks great on
   Twitter/LinkedIn. For the "storyteller" mode, this is how the tool spreads. Template-based is fine for V1 — reliable,
   information-dense, and eventually recognizable as a gitstrata card.

5. **Refine the product positioning.** Move from "see how your codebase grows" (descriptive, passive) to something that
   conveys "understand the story of your codebase" or "the x-ray for modern codebases." The tool should have a point of
   view about software development in the AI age.
