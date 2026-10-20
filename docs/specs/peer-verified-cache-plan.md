# Peer-verified shared cache plan

Serve one visitor's analysis to everyone else, without trusting that visitor. Builds on the shared cache from
[shared-cache-plan.md](shared-cache-plan.md), which is implemented but switched off (the R2 binding is commented out).

## Problem

- Every visitor recomputes every repo from scratch: minutes of cloning and counting for popular repos that thousands of
  folks have already analyzed.
- The existing shared cache can't be switched on safely. Its write token is `PUBLIC_CACHE_WRITE_TOKEN`, so it ships in
  the JS bundle and authenticates nothing. Anyone can PUT a well-formed fake result for any repo, as long as the
  `headCommit` is real.
- Recomputing on the server to verify is ruled out: no spare compute (the Hetzner box is reserved for other projects),
  and a Cloudflare Worker can't clone and count large repos.

## Decisions (from David)

- **Peer verification**: visitors' browsers verify each other's results. No server-side counting.
- **Plausibility checks**: cheap server-side gates against third-party data (GitHub languages API).
- **No trusted precompute** on Hetzner.
- **No "unverified" or "verified by visitors" UI.** Nothing in the UI hints at the mechanism.

## Core idea

Checking a result is much cheaper than computing it. A full analysis replays the whole history. One day's data point
needs only one snapshot: a shallow fetch of that day's commit, counted with the same code. So a result with N days can
be spot-checked with K snapshot counts, K much smaller than N.

The server hands spot-checks to random visitors' browsers, for random repos from a global queue. Task IDs are opaque, so
a voter can't tell what it's checking until it accepts, can't pick, and never sees the expected values. Known-answer
"canary" tasks are mixed in, and only voters from networks that recently answered a canary correctly count toward
promotion. Together, these are the defense against one attacker voting for their own fake from many IPs (a Sybil
attack).

The repo is public, so the design must hold up when an attacker reads the code. Hiding the mechanism in the UI is about
UX, not security.

## Threat model

- **Vandal (main threat)**: uploads fake numbers, or offensive commit messages or author names, for a popular repo, so
  every later visitor sees them.
- **Sybil**: same, plus confirms their own fake from many IPs or networks.
- **Griefer**: tries to get honest entries taken offline, forcing recomputes. Low impact: the fallback is today's
  behavior.
- **Flooder**: fills storage with junk. Covered by size limits, rate limits, and the plausibility gate.

Stakes are low (a LoC chart of a public repo), so the goal is to make tampering expensive and unrewarding, not
impossible.

## How the pipeline buckets days (facts this design relies on)

- Commits are bucketed by **author** date (`history.ts` `getCommitsByDate`), across all branches reachable from the
  default branch, and processed in author-timestamp order. A day's language state is the tree of the last commit
  processed that day (diffing consecutive processed trees telescopes to that tree).
- So HEAD isn't necessarily the last processed commit (a rebased or merged tip keeps an older author date), and merging
  a PR with old author dates rewrites past days. Results for the same HEAD are still deterministic; results for
  different HEADs can differ anywhere, not just at the end.
- Velocity (`languageAdded`/`languageRemoved`) is a diff against each commit's git parent, and merge commits are
  skipped. It doesn't telescope to the day-to-day state change, so no consistency check can tie the two together.

## Design

### Layer 1: deterministic, commit-bound data (prerequisite)

Spot-checks only work if "count the snapshot of day D" gives exactly what the full pipeline reported for day D, and two
honest analyses of the same HEAD produce byte-identical canonical results.

- **Store commits per day**: add `DayStats.commit?: string` (the last processed commit, whose tree the day's state
  reflects) and `DayStats.commitOids?: string[]` (every commit bucketed into the day, in processing order). Gap days
  carry neither. `commitOids` lets voters check the day's messages and authors (see the evidence section below). For
  scale, the `comments` field already holds every commit message, so OIDs add at most about 40% to the payload.
- **Make day counts a pure function of the day's tree.** Today they aren't:
    - `allExtensions` accumulates across history and drives the `.h` → C++ reassignment (`languages.ts`), so a `.h`
      file's language depends on which `.cpp` files existed in earlier commits.
    - `blobCache` is keyed by OID+path and caches the language, so a `.h` blob classified as C stays C after C++ files
      show up. LRU eviction makes the outcome depend on cache pressure, too.
    - **Bug**: in `diffTreesDetailed` (`count.ts`), when a path changes from a file to a folder (or back), the old
      entries never get deleted, because the deletion loop skips paths that still exist. Stale entries stay in
      `fileStateMap`.
    - Fix: derive the extension set from the current tree (`fileStateMap` keys) at each commit; when the `.h` mapping
      flips, reclassify the affected `.h` entries; include the mapping in the `blobCache` key; fix the file↔folder diff.
      Measure the perf cost on a large C/C++ repo.
- **Prove equivalence with a test**: for fixture repos, assert that for every day, the diff pipeline's `languages`
  equals a fresh full-tree count of `DayStats.commit`. Fixtures must include `.h` files predating `.cpp` files and a
  path changing between file and folder.
- **Canonical form**: one function, shared by client and server, that serializes `days` for hashing:
    - Sort object keys recursively. (`languages` insertion order differs between a full walk and diffs today.)
    - Sort `comments` and `authors`, or define them in `commitOids` order. They currently follow `git.log` traversal
      order.
    - Normalize empty versus absent (`prod`/`test` undefined, velocity maps `{}` versus missing).
    - Exclude `analyzedAt`, `repoSizeBytes`, and other display metadata.
    - The server derives `detectedLanguages`, `totalContributors`, and similar summaries itself and never trusts the
      submitted ones.
- **Counting engine version**: a `countingEngineVersion` constant, bumped whenever counting or bucketing rules change
  (`languages.ts`, `count.ts` classification, `history.ts` bucketing, mailmap handling). It's part of the cache key, so
  results from different rules never mix. A test fingerprints the language registry and fails with "bump
  `countingEngineVersion`" when it changes.
- **Upload only fresh full analyses.** `analyzeIncremental` isn't exact today:
    - It keeps only days after the last cached date, so newly merged commits with older author dates are dropped.
    - When no new days exist, it bumps `headCommit` without touching `days`.
    - `.mailmap` is read at HEAD, so a `.mailmap` change rewrites every past day's authors, which incremental never
      redoes.

    Its results stay local. Making incremental exact is a separate fix: it's also a correctness bug in today's product.
    It isn't a dependency of this plan.

### Layer 2: internal consistency (cheap, at PUT)

Extend `cors-proxy/src/validate-cache-entry.ts`:

- Dates strictly ascending and consecutive.
- Non-gap days have a valid `commit`, and their `commitOids` end with `commit`.
- Gap days (no commits) exactly equal the previous day's counts, with `comments: ["-"]`, empty `authors`, and empty
  velocity maps. That pins every gap day to a spot-checkable day, so forged gap values can't hide there.
- `total` equals the sum of language totals, and `prod + test` equals `total` for split languages.
- `headCommit` appears in some day's `commitOids` (not necessarily the last day; see the bucketing section), and in the
  git host's refs (existing `verifyHeadCommit`).
- Hard caps on day count and payload size, sized to fit the Worker CPU budget (see the server components section).

There are deliberately no velocity-vs-state or contributor-sum invariants: the pipeline doesn't guarantee them (see the
bucketing section).

### Layer 3: plausibility (cheap, at PUT)

- **GitHub languages API** (`/repos/{owner}/{repo}/languages`, bytes per language at the default branch): compare with
  the last day's counts. Map linguist names to our language IDs. For the top languages by bytes: the language must
  appear in our result, and bytes-per-line must fall within a loose band (start at 5–300).
- **GitLab and Bitbucket**: skip this layer for now. GitLab only returns percentages.
- A Worker secret `GITHUB_API_TOKEN` (fine-grained, public read-only) gives 5,000 requests/hour. Cache API responses for
  one hour per repo.
- **Start in log-only mode.** Linguist excludes vendored, docs, and generated files while we may count some of them, so
  false rejections are likely until the bounds are calibrated against real results. Enforce once the logs show it's
  safe.
- When enforced: a mismatch rejects the submission, and an API outage lets it through (it stays pending, and peer checks
  still apply).
- The reviewer rated this layer mostly redundant next to the peer checks. It stays because it's cheap and stops garbage
  before it costs any voter bandwidth, but it's the first thing to cut if it causes trouble.

### Layer 4: peer verification

#### States

Per `(repoUrl, countingEngineVersion, headCommit)`, a ledger tracks candidates. A candidate is one distinct submitted
result, identified by the SHA-256 of its canonical form.

- **Pending**: passed Layers 2–3, not yet served to anyone.
- **Verified**: served by `GET`. The newest verified candidate per repo is the served one.
- **Disputed**: a spot-check mismatch is being resolved; not served.
- **Rejected**: lost a dispute; kept as a tombstone (hash only) so resubmissions are dropped.

Only verified candidates are ever served. Visitors who'd hit a pending entry compute it themselves, exactly as today, so
nobody sees an unchecked result and there's no "unverified" UI to build.

#### Evidence

- **Full-compute agreement**: another visitor's fresh full analysis of the same HEAD, with the same canonical hash, from
  a different network. It covers contributors and velocity, which spot-checks don't.
- **Spot-check match**: a server-assigned voter with canary standing (see the tasks section) fetches the day's `commit`
  and checks:
    - Its counts match the day's `languages` exactly.
    - Its author date falls on that day.

    The voter also fetches the commit objects in `commitOids` without trees (`filter=tree:0`), which is cheap, and
    checks:
    - The day's `comments` and `authors` are exactly the messages and normalized authors of those commits. Nothing
      added, nothing missing.
    - Each commit's author date falls on that day.

- **Distinct networks**: two pieces of evidence count as independent only if they come from different networks:
  different IPv4 /24 (IPv6 /48), and at least two distinct ASNs across the evidence for one promotion
  (`request.cf.asn`). The submitter's network never counts as a confirmer.

#### Promotion rule

A pending candidate becomes verified when all of these hold:

1. At least one full-compute agreement from a distinct network.
2. At least K = 3 spot-check matches from three distinct networks with canary standing. One is on the last non-gap day,
   and the others are on random non-gap days weighted toward recent ones. Each match covers that day's counts, messages,
   and authors.
3. No open disputes.

Until then, visitors compute the repo themselves as today, and each fresh upload is new evidence. Low-traffic repos may
never get promoted, which costs nothing compared to today.

When a repo moves to a new HEAD, its candidates start from scratch. Bucketing by author date means a new HEAD can
legitimately change old days, so reusing evidence across HEADs isn't safe. Optimization for later: reuse spot-check
evidence for a day whose `commit` and canonical day hash are unchanged. The old verified entry keeps being served until
a newer one is promoted. It's stale, but correct for its HEAD, same as the IndexedDB cache today.

#### Tasks

- After a visitor's own result is on screen (computed, or served from cache) and the tab has been idle for 10 s, the
  page asks for a task: `GET /verify/v1/task`. The server picks one, returns 204 when there's nothing to do, or returns:
    - An **opaque task ID** (random, stored in D1): no signed claims the client can read before accepting.
    - The fetch instructions: `repoUrl`, the commit OIDs, and the engine version. These are needed to do the work, so
      the voter learns the repo at that point. Each task is still single-use and bound to the requesting network, so
      learning the repo doesn't let the voter re-roll for a better one.
- **What the server picks**:
    - Mostly a random open spot-check from the global queue: any repo, never one the requester's network submitted or
      already voted on.
    - About one in four tasks is a **canary**: a day from an already verified entry, with a known answer.
    - When the queue is small, the server sends canaries more often. That way, at low traffic an attacker drawing tasks
      mostly sees canaries, not their own candidate.
- **Canary standing**: a network counts toward promotion only if it answered a canary correctly in the last 24 h. A
  wrong canary answer marks the network as untrusted for 30 days, and its votes stop counting.
- **Single use and binding**: a task ID accepts exactly one result, only from the network it was issued to, within 10
  minutes.
- **Caps**: at most five tasks per network per day, and skips count toward the cap. That stops "skip until I draw my own
  candidate".
- **Voter budget**:
    - At most one task per page view.
    - Snapshots up to 20 MB by default. Voters on fast, unmetered connections that stay idle longer can take up to 150
      MB, and the client reports its tier when asking for a task.
    - No tasks when `navigator.connection.saveData` is on, on 2G/3G, or while the visitor runs their own analysis.
    - The client cancels the task when the visitor starts an analysis or leaves.
- **Single-commit fetch**: a hand-built protocol v2 `git-upload-pack` POST with `want <oid>` and `deepen 1`, and
  `filter=tree:0` for the message-only fetch. The pack is indexed with isomorphic-git's `indexPack`. The proxy's path
  allowlist already permits this POST. Archive or tarball endpoints are out: `export-ignore` in `.gitattributes` drops
  files, so their counts differ.

#### Disputes

- Only a spot-check mismatch from an assigned voter with canary standing opens a dispute. A cheap PUT can't open one.
- A full analysis with a different hash is another candidate, not a dispute. The server finds the first day where the
  two candidates differ and queues spot-checks of that day for both. That settles which one is right.
- In a dispute, a verified candidate stops being served. The server re-issues the same day to more voters and resolves
  by majority among at least three distinct-network votes with canary standing. The loser is rejected (if it's the
  candidate) or marked untrusted (if it's the voter).
- A griefer can take an entry offline for a while at most, and to do that they need canary standing, which means doing
  honest work first.

#### Ongoing audits

Canaries double as audits: every canary re-checks a verified entry, so a fake that slipped through gets caught later.
When honest voters disagree with a verified entry's answer, that opens a dispute.

### Server components (all Cloudflare)

- **Workers Paid plan** ($5/month): needed for the PUT path's CPU budget. Gunzipping, parsing, hashing, and validating a
  large result can take hundreds of milliseconds, while the free plan allows 10 ms of CPU per request. Confirm the
  current plan in M0. Cap payloads well below the existing 50 MB decompressed limit, sized from measured CPU time on the
  largest supported repo.
- **R2** (existing bucket): candidate blobs at
  `results/v2/{engineVersion}/{repoHash}/{headCommit}/{candidateHash}.json.gz`.
- **D1** (new): ledger tables for candidates, evidence, tasks, and network standing. It's small, relational, and needs
  transactions. Durable Objects (one per repo) are the alternative if D1 write contention shows up.
- **Routes** (in the existing `cors-proxy` Worker):
    - `GET /cache/v2/:repoHash`: the served verified entry or 404.
        - The verified pointer lives in D1 and names an immutable R2 object.
        - Responses are edge-cached for five minutes. Cache purges only reach the local data center, so a disputed entry
          may keep showing for up to five minutes elsewhere. That's acceptable.
    - `PUT /cache/v2/:repoHash`: submit a fresh full result. Always 202, whether it's stored, counted as evidence, or
      dropped. This reveals nothing to a prober.
    - `GET /verify/v1/task` and `POST /verify/v1/result`.
- Remove `PUBLIC_CACHE_WRITE_TOKEN` and the bearer check: they add no security. Keep IP rate limits.
- The v1 routes and entries go away. v1 entries lack per-day commits, so they're unverifiable anyway.

### Client changes

- `count.ts` / `history.ts` / `analyzer.worker.ts`:
    - Per-day `commit` and `commitOids`.
    - Tree-pure classification and the file↔folder diff fix.
    - The canonical serializer.
    - A new `countSnapshot({ repoUrl, commit })` that fetches and counts one commit with the same classification code.
    - A new `fetchCommitMeta({ repoUrl, oids })` for the tree-less message check.
- `server-cache.ts`: v2 endpoints, no token. Upload only after a fresh full `analyze`, never after `analyzeIncremental`.
- New `src/lib/peer-verify.ts`: idle detection, budget tiers, task fetch, worker call, and result post. It's fully
  silent: no UI, no console noise in prod, and errors are swallowed.
- Never upload results from authenticated (private) analyses. The server already fails closed for them (the refs lookup
  without auth fails), but the client shouldn't send them at all.

## Risks and open questions

1. **Fetching one commit by OID.**
    - Plan: a hand-built v2 upload-pack request (`want <oid>`, `deepen 1`), then `indexPack`. GitHub and GitLab allow
      wanting any reachable commit over protocol v2.
    - Verify through the proxy in a spike before anything else; the whole plan depends on it.
    - Also check `filter=tree:0` support on both hosts.
2. **Silently using visitors' bandwidth and CPU.**
    - It's small (usually 20 MB or less, seconds of CPU, at most once per visit), but it's still the visitor's
      resources.
    - Suggestion: one plain line on the about page or in the FAQ ("Your browser occasionally double-checks a cached
      result for another repo, to keep shared results honest"). That discloses it without drawing attention in the main
      UI.
    - David's call.
3. **Big repos.** Snapshots over 150 MB can't be spot-checked, so those repos never get promoted, though they're the
   ones that would benefit most. Options for later:
    - Per-path-prefix subtotals, so voters can check a slice of the tree.
    - A higher tier for voters who opt in.
4. **Low traffic.** Promotion needs real visitors for full computes, spot-checks, and canaries. With little traffic,
   most repos stay pending, which costs nothing compared to today. Featured repos get the most traffic, so they're
   promoted first, which is where it matters. Bootstrapping: the first canaries need some verified entries. Seed them by
   having David's own browser vote on a few featured repos, treated as trusted for the bootstrap only.
5. **Determinism across browsers.** `TextDecoder` and line splitting must behave the same everywhere. The equivalence
   test runs in Node; add a check in Playwright with Chromium, Firefox, and WebKit.
6. **Network identity.** /24 plus ASN is weak against residential-proxy farms. Canary standing raises the cost (honest
   work per network per day), but it doesn't eliminate the risk. Acceptable for the stakes.

## Parameters (initial, tune with data)

- K (spot-checks for promotion): 3, one on the last non-gap day
- Full-compute agreements for promotion: 1 from a distinct network
- Distinct network: /24 (IPv4), /48 (IPv6); at least two ASNs per promotion
- Canary share: about one in four tasks, more when the queue is small
- Canary standing: valid for 24 h; a wrong answer means untrusted for 30 days
- Task expiry: 10 min, single use, bound to the network
- Tasks per network per day: 5, skips included
- Snapshot budget: 20 MB default, 150 MB for the fast-and-idle tier
- Idle delay before taking a task: 10 s

## Testing

- Unit:
    - Canonical serializer (key order, empty versus absent, sorting).
    - Layer 2 validators, including gap-day pinning and `headCommit` membership.
    - Plausibility bounds.
    - Ledger state machine (promotion, new-HEAD reset, disputes, canary standing).
    - Task single use, network binding, and caps.
- Equivalence: diff pipeline vs snapshot count on fixture repos (Layer 1), plus identical canonical hashes for two full
  analyses of the same HEAD.
- Worker integration: `cors-proxy` tests against Miniflare D1 + R2 bindings, plus a CPU-time measurement of PUT on the
  largest supported payload.
- End-to-end: browser contexts on distinct simulated networks submit, answer canaries, and spot-check a small repo until
  it's promoted. One more context then gets the instant result.
- Adversarial cases:
    - A tampered day, a tampered gap day, and an injected commit message.
    - A wrong HEAD.
    - A Sybil confirmer from the submitter's /24.
    - An attacker skipping tasks to draw their own candidate.
    - A replayed task ID.
    - A false mismatch voter with and without canary standing.

## Docs

- `cors-proxy/CLAUDE.md`: v2 routes, ledger, D1, secrets, removed token, CPU budget.
- `src/lib/CLAUDE.md`:
    - Per-day `commit`/`commitOids`.
    - Author-date bucketing facts.
    - Tree-pure classification.
    - Canonical form.
    - `countSnapshot`/`fetchCommitMeta`.
    - `peer-verify.ts`.
- `docs/architecture.md` and `docs/deploying.md`: Workers Paid, D1 setup, `GITHUB_API_TOKEN`.
- Mark `shared-cache-plan.md` as superseded by this plan.

## Task list

### Milestone 0: spikes and decisions

- [ ] Fetch and count a single commit by OID through the proxy (GitHub, GitLab), plus a `filter=tree:0` fetch
- [ ] Confirm the Workers plan (Paid needed), and the D1 and R2 limits for the expected load
- [ ] Decide on the disclosure line (risk 2)

### Milestone 1: deterministic, commit-bound data

- [ ] Fix the file↔folder stale-entry bug in `diffTreesDetailed` (test first)
- [ ] Make classification a pure function of the day's tree (`.h` mapping, `blobCache` key)
- [ ] Add per-day `commit` and `commitOids`
- [ ] Shared canonical serializer, with the server deriving summary fields
- [ ] `countingEngineVersion` with the registry fingerprint test
- [ ] `countSnapshot` + `fetchCommitMeta` (with `indexPack`), and the diff-vs-snapshot equivalence test
- [ ] Two full analyses of the same HEAD produce identical canonical hashes
- [ ] Measure the perf impact on a large C/C++ repo

### Milestone 2: server ledger and gates

- [ ] D1 schema and migrations; R2 v2 key layout
- [ ] Layer 2 checks in `validate-cache-entry.ts`, with payload caps sized from the measured PUT CPU time
- [ ] Plausibility gate (GitHub) in log-only mode
- [ ] `PUT /cache/v2` (candidates, full-compute agreement, first-differing-day detection) and `GET /cache/v2`
- [ ] Client uploads only after a fresh full `analyze`, never for private repos
- [ ] Remove `PUBLIC_CACHE_WRITE_TOKEN`, the bearer check, and the v1 routes

### Milestone 3: peer spot-checks

- [ ] Task store: opaque IDs, single use, network binding, expiry, per-network caps
- [ ] `GET /verify/v1/task` (queue + canary mix) and `POST /verify/v1/result`
- [ ] `peer-verify.ts` with idle detection, budget tiers, and cancellation
- [ ] Canary standing and the promotion rule with distinct-network accounting
- [ ] Bootstrap: seed verified featured repos

### Milestone 4: disputes

- [ ] Dispute state, re-issued tasks, and majority resolution
- [ ] Untrusted-network marking for wrong canary answers and lost disputes

### Milestone 5: rollout

- [ ] Adversarial and end-to-end tests green; `./scripts/check.sh` green
- [ ] Update docs (see the docs section)
- [ ] Enable R2 + D1 in prod; set secrets; set `PUBLIC_SHARED_CACHE_URL`
- [ ] Calibrate the plausibility bounds from the logs, then enforce
- [ ] Watch promotion, canary, and dispute counts for two weeks, then tune the parameters

### Separate follow-up (not blocking)

- [ ] Make `analyzeIncremental` exact (back-dated merged commits, `.mailmap` changes, no-new-days case), then allow
      incremental uploads
