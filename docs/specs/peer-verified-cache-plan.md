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

Spot-checks are handed out by the server to random visitors' browsers, for random repos from a global queue. A voter
never sees the expected values and can't choose which candidate it checks. That random assignment is the main defense
against one attacker voting for their own fake from many IPs (a Sybil attack).

The repo is public, so the design must hold up when an attacker reads the code. Hiding the mechanism in the UI is about
UX, not security.

## Threat model

- **Vandal (main threat)**: uploads fake numbers or offensive commit messages for a popular repo, so every later visitor
  sees them.
- **Sybil**: same, plus confirms their own fake from many IPs or networks.
- **Griefer**: submits false mismatch votes to get honest entries taken down, forcing recomputes. Low impact: the
  fallback is today's behavior.
- **Flooder**: fills storage with junk. Covered by existing size limits, rate limits, and the plausibility gate.

Stakes are low (a LoC chart of a public repo), so the goal is to make tampering expensive and unrewarding, not
impossible.

## Design

### Layer 1: deterministic, commit-bound data (prerequisite)

Spot-checks only work if "count the snapshot of day D" gives exactly what the full pipeline reported for day D.

- **Store the commit per day**: add `DayStats.commit?: string`, the OID of the last commit processed that day (the
  pipeline processes commits in timestamp order across branches, so this is the commit whose tree the day's state
  reflects). Gap days carry no `commit`.
- **Make day counts a pure function of the day's tree.** Today they aren't:
    - `allExtensions` accumulates across history and drives the `.h` → C++ reassignment (`languages.ts`), so a `.h`
      file's language depends on which `.cpp` files existed in earlier commits.
    - `blobCache` is keyed by OID+path and caches the language, so a `.h` blob classified as C stays C after C++ files
      show up.
    - Fix: derive the extension set from the current tree (`fileStateMap` keys) at each commit, and when the `.h`
      mapping flips, reclassify the affected `.h` entries. Include the mapping in the `blobCache` key. Measure the perf
      cost on a large C/C++ repo.
- **Prove equivalence with a test**: for a few fixture repos (incl. a C/C++ one with `.h` files predating `.cpp` files),
  assert that for every day, the diff pipeline's `languages` equals a fresh full-tree count of `DayStats.commit`.
- **Counting engine version**: `countingEngineVersion` constant, bumped whenever counting rules change (`languages.ts`,
  `count.ts` classification). It's part of the cache key, so results from different rules never mix. A test fingerprints
  the language registry and fails with "bump `countingEngineVersion`" when it changes.

### Layer 2: internal consistency (cheap, at PUT)

Extend `cors-proxy/src/validate-cache-entry.ts`:

- Dates strictly ascending and consecutive; `commit` present on every non-gap day and valid hex.
- Last day's `commit` equals `headCommit`.
- `total` equals the sum of language totals; `prod + test` equals `total` for split languages.
- Net change per language per day equals `languageAdded − languageRemoved` (telescoping). Verify in M0 that the pipeline
  actually guarantees this (renames, binary files, files flipping language); if not, fix the pipeline or drop this
  check.
- Contributor cumulative counts sum to the day total, if the pipeline guarantees it (verify in M0).

These checks force a forger to fake a consistent chain. A tweak to one day ripples through all later days, so random
spot-checks catch it.

### Layer 3: plausibility (cheap, at PUT)

- **GitHub languages API** (`/repos/{owner}/{repo}/languages`, bytes per language at the default branch): compare with
  the last day's counts. Map linguist names to our language IDs. For the top languages by bytes: the language must
  appear in our result, and bytes-per-line must fall within a loose band (start at 5–300, tune on real data).
- **GitLab**: `/projects/:id/languages` returns percentages only, so check that the top three languages overlap.
  **Bitbucket**: skip this layer.
- A Worker secret `GITHUB_API_TOKEN` (fine-grained, public read-only) gives 5,000 requests/hour. Cache API responses for
  one hour per repo.
- Fail closed for a mismatch, fail open for an API outage (the entry stays pending; peer checks still apply).
- Linguist excludes vendored files, docs, and generated code while we may count some of these, so this is a coarse gate
  against garbage, not proof. Calibrate the bounds by running real results from the IndexedDB cache through it before
  enforcing.

### Layer 4: peer verification

#### States

Per `(repoUrl, countingEngineVersion)`, a ledger tracks candidates. A candidate is one distinct submitted result,
identified by its canonical hash: SHA-256 of the canonical JSON of `days` (everything except `analyzedAt`,
`repoSizeBytes`, and other display-only metadata).

- **Pending**: passed Layers 2–3, not yet served to anyone.
- **Verified**: served by `GET`.
- **Disputed**: had a mismatch; not served; awaiting resolution.
- **Rejected**: lost a dispute; kept as a tombstone (hash only) so resubmissions are dropped.

Only verified candidates are ever served. Visitors who'd hit a pending entry compute it themselves, exactly as today, so
nobody sees an unchecked result and there's no "unverified" UI to build.

#### Evidence

- **Full-compute agreement**: another visitor's full analysis with the same canonical hash from a different network.
  This is the strongest evidence: it covers comments, authors, contributors, and velocity, which spot-checks don't.
- **Spot-check match**: a server-assigned voter counted the snapshot of one day's `commit` and got identical
  `languages`. The voter also checks that the commit's committer date falls on that day, and that its message appears in
  the day's `comments`.
- **Distinct networks**: two pieces of evidence count as independent only if they come from different networks:
  different IPv4 /24 (IPv6 /48) and, for promotion, at least two distinct ASNs overall (`request.cf.asn`). The
  submitter's network never counts as a confirmer.

#### Promotion rule

A pending candidate becomes verified when all of these hold:

1. At least one full-compute agreement from a distinct network.
2. At least K = 3 spot-check matches from three distinct networks, one of them on the HEAD day. The others go to random
   non-gap days, weighted toward recent days.
3. No unresolved mismatches.

Until then, visitors compute the repo themselves, and each of their uploads is new evidence. Low-traffic repos may never
get promoted, which costs nothing compared to today.

#### Extensions (new HEAD)

When a repo moves on, a visitor's fresh analysis produces a candidate whose days start with the verified entry's days.
The ledger compares per-day hashes: an identical prefix inherits its verification, and only the new tail needs evidence.
Spot-checks then target tail days plus the new HEAD, and the full-compute-agreement requirement applies to the tail
only. The old verified entry keeps being served until the extension is promoted.

#### Tasks

- After a visitor's own result is on screen (computed, or served from a cache) and the tab has been idle for 10 s, the
  page asks for a task: `GET /verify/v1/task`. The server picks a random open spot-check from the global queue (any
  repo, never one the requester submitted or voted on) and returns it, or 204.
- The task is a signed token (HMAC with a Worker secret): candidate ID, day, `commit`, `repoUrl`, engine version, expiry
  (10 min). The expected values stay on the server.
- The worker shallow-fetches that one commit, counts its tree with the shared counting code, and posts
  `POST /verify/v1/result` with `{ token, languages }` or `{ token, skipped: reason }`.
- Budget: at most one task per page view, and only for snapshots up to 20 MB (abort the fetch beyond that and report
  `skipped`). No tasks when `navigator.connection.saveData` is on, on 2G/3G, or when the visitor is analyzing something
  themselves. The task is cancelled when the visitor starts an analysis or leaves.
- `skipped` is neutral: the task goes back into the queue for someone else.

#### Disputes

- A mismatch (spot-check or a full compute with a different hash) moves a verified candidate to disputed, so it stops
  being served right away. Pending candidates stay pending, flagged.
- The server re-issues the same day as a task to more voters. It resolves by majority among at least three
  distinct-network votes on that day.
    - If the candidate loses, it's rejected. The submitter's network gets a strike.
    - If it wins, it's restored. Each false-mismatch voter's network gets a strike.
- Networks with three or more strikes get shadow-banned: their submissions and votes return success but get dropped.
  Strikes expire after 30 days.
- A griefer can take an entry offline temporarily at most, which costs visitors nothing beyond today's recompute.

#### Ongoing audits

Verified candidates keep receiving spot-checks at a low rate (for example, one in 50 tasks), so fakes that slipped
through get caught later.

### Server components (all Cloudflare)

- **R2** (existing bucket): candidate blobs at `results/v2/{engineVersion}/{repoHash}/{candidateHash}.json.gz`, and the
  verified pointer.
- **D1** (new): ledger tables for candidates, evidence, tasks, and strikes. It's small, relational, and needs
  transactions. Durable Objects (one per repo) are the alternative if D1 write contention shows up. Confirm free-tier
  limits in M0.
- **Routes** (in the existing `cors-proxy` Worker):
    - `GET /cache/v2/:repoHash`: the verified entry or 404 (edge-cached for five minutes; purged on dispute).
    - `PUT /cache/v2/:repoHash`: submit a full result. Always 202, whether stored, merged as evidence, or dropped. This
      reveals nothing to a prober.
    - `GET /verify/v1/task` and `POST /verify/v1/result`.
- Remove `PUBLIC_CACHE_WRITE_TOKEN` and the bearer check: they add no security. Keep IP rate limits. Open question:
  Turnstile in invisible mode on writes.
- The v1 routes and entries go away. v1 entries lack per-day commits, so they're unverifiable anyway.

### Client changes

- `count.ts` / `analyzer.worker.ts`: per-day `commit`, tree-pure classification, and a new
  `countSnapshot({ repoUrl, commit })` that fetches and counts one commit with the same classification code.
- `server-cache.ts`: v2 endpoints, no token.
- New `src/lib/peer-verify.ts`: idle detection, budget checks, task fetch, worker call, result post. Fully silent: no
  UI, no console noise in prod, errors swallowed.
- Never upload results from authenticated (private) analyses. The server already fails closed for them (refs lookup
  without auth fails), but the client shouldn't send them at all.

## Risks and open questions

1. **Fetching one commit by OID.** isomorphic-git's `fetch` resolves `ref` against advertised refs, so a bare OID may
   not work. Options:
    - (a) GitHub and GitLab allow `want <oid>` for reachable commits over protocol v2, so craft the upload-pack request
      ourselves (`want <oid>`, `deepen 1`) and index the returned pack with isomorphic-git. This is exact.
    - (b) The archive (tarball) endpoints via the proxy. Simpler, but `export-ignore` in `.gitattributes` drops files,
      so counts differ. Not exact; avoid.

    Spike this first; the whole plan depends on it. Also check whether `filter blob:limit` or a sparse fetch can keep
    big snapshots under budget.

2. **Silently using visitors' bandwidth and CPU.** It's small (≤20 MB, seconds of CPU, at most once per visit), but it's
   still the visitor's resources. Suggestion: one plain line on the about page or in the FAQ ("Your browser occasionally
   double-checks a cached result for another repo, to keep shared results honest"), so it's disclosed without drawing
   attention in the main UI. David's call.
3. **Low traffic.** Promotion needs real visitors for both full computes and spot-checks. With little traffic, most
   repos stay pending, which costs nothing compared to today. Featured repos get the most traffic, so they get promoted
   first, which is where it matters.
4. **Residual risk on comments and authors.** These are only proven by full-compute agreement. A Sybil attacker with two
   networks can fake that, and spot-checks only sample one message per checked day. Mitigation if it ever matters:
   voters fetch all of a day's commits (`deepen-since`) and check the whole `comments` list.
5. **Determinism across browsers.** `TextDecoder` and line splitting must behave the same everywhere. The equivalence
   test runs in Node; add a check in Playwright with Chromium, Firefox, and WebKit.

## Parameters (initial, tune with data)

- K (spot-checks for promotion): 3, one on HEAD
- Full-compute agreements for promotion: 1 from a distinct network
- Distinct network: /24 (IPv4), /48 (IPv6); at least two ASNs overall
- Task token expiry: 10 min
- Snapshot budget: 20 MB
- Audit rate for verified entries: about one in 50 tasks
- Strike threshold: 3 strikes in 30 days → shadow ban
- Idle delay before taking a task: 10 s

## Testing

- Unit: canonical hashing, consistency validators, plausibility bounds, ledger state machine (promotion, extension
  prefix inheritance, dispute resolution, strikes), task token signing and expiry.
- Equivalence: diff pipeline vs snapshot count on fixture repos (Layer 1).
- Worker integration: `cors-proxy` tests against Miniflare D1 + R2 bindings.
- End-to-end: two browser contexts on distinct simulated networks submit and spot-check a small repo until it's
  promoted; a third gets the instant result.
- Adversarial: a tampered day, a tampered tail, a wrong HEAD, a Sybil confirmer from the submitter's /24, and a false
  mismatch voter.

## Docs

- `cors-proxy/CLAUDE.md`: v2 routes, ledger, D1, secrets, removed token.
- `src/lib/CLAUDE.md`: per-day `commit`, tree-pure classification, `countSnapshot`, `peer-verify.ts`.
- `docs/architecture.md` and `docs/deploying.md`: D1 setup, secrets (`GITHUB_API_TOKEN`, task HMAC key).
- Mark `shared-cache-plan.md` as superseded by this plan.

## Task list

### Milestone 0: spikes

- [ ] Fetch and count a single commit by OID from GitHub and GitLab through the proxy (risk 1)
- [ ] Check whether the net-delta and contributor-sum invariants hold in the pipeline
- [ ] Confirm D1 and R2 free-tier limits cover the expected load
- [ ] Calibrate the plausibility bounds against real cached results

### Milestone 1: deterministic, commit-bound data

- [ ] Add per-day `commit` to `DayStats`
- [ ] Make classification a pure function of the day's tree (`.h` mapping, `blobCache` key)
- [ ] Add `countingEngineVersion` with the registry fingerprint test
- [ ] Extract `countSnapshot` and add the diff-vs-snapshot equivalence test
- [ ] Measure the perf impact on a large C/C++ repo

### Milestone 2: server ledger and gates

- [ ] D1 schema and migrations; R2 v2 key layout
- [ ] Extend `validate-cache-entry.ts` with the Layer 2 checks
- [ ] Plausibility gate with GitHub and GitLab languages APIs
- [ ] `PUT /cache/v2` (candidates, canonical hash, full-compute agreement, prefix inheritance) and `GET /cache/v2`
- [ ] Remove `PUBLIC_CACHE_WRITE_TOKEN`, the bearer check, and the v1 routes

### Milestone 3: peer spot-checks

- [ ] Task queue, HMAC tokens, `GET /verify/v1/task`, `POST /verify/v1/result`
- [ ] `peer-verify.ts` with idle detection, budgets, and cancellation
- [ ] Promotion rule with distinct-network accounting

### Milestone 4: disputes and audits

- [ ] Dispute state, re-issued tasks, majority resolution, and edge-cache purge
- [ ] Strikes, shadow ban, and expiry
- [ ] Ongoing audits of verified entries

### Milestone 5: rollout

- [ ] Adversarial and end-to-end tests green; `./scripts/check.sh` green
- [ ] Update docs (see the docs section)
- [ ] Enable R2 + D1 in prod; set secrets; set `PUBLIC_SHARED_CACHE_URL`
- [ ] Watch promotion and dispute counts for two weeks, then tune the parameters
