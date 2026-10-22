# Rolling refresh and device sync plan

Stop recomputing repos from scratch. Once a repo is analyzed on one device, every device shows it instantly, and every
refresh only processes what changed.

## Context

- **Traffic is small**: one to nine visitors a day (Umami, 2026-09-20 to 2026-10-20). Most of it is David's own repos,
  on his laptop and phone, plus a few folks he sends links to. The design must work at this scale, so no mechanism may
  depend on many visitors.
- **The proxy Worker runs on the free plan, and that's permanent.** That means 10 ms of CPU per request, so the Worker
  can't gunzip, parse, or validate results. It only checks headers and streams bytes.
- **No server-side compute** beyond the Worker. The Hetzner box is reserved for other projects.

## Decisions

- **Trusted devices write; everyone reads.** A device with a personal write key uploads results to the shared cache.
  Anonymous visitors only read. Keys are minted by David and handed off with a `#write-key=` link.
- **Same-device refresh is exact and incremental.** The LightningFS clone persists per repo, so a refresh fetches new
  commits and recounts only the days they affect.
- **Keep the current day model for now** (author-date buckets across branches). Exactness comes from rewinding to the
  earliest affected day, not from changing what a day means.
- **No "verified" or "shared by" UI** beyond the existing "Shared result" badge.

## Design

### Trusted-device sharing

- **Keys**: random 24-byte hex strings. The Worker secret `WRITE_KEY_HASHES` holds their SHA-256 hashes,
  comma-separated. David's key is in sops as `GITSTRATA_WRITE_KEY_DAVID`.
- **Handoff**: opening `https://gitstrata.com/#write-key=KEY` stores the key in localStorage and strips it from the URL.
  The GitHub key popup shows "Sharing key: on" with a way to remove it.
- **Upload**: after an analysis (full or incremental), only when a write key is set and the analysis didn't use a GitHub
  token. `PUT /cache/v1/:repoHash` with the gzip body, `Authorization: Bearer KEY`, `X-Repo-Url`, and `X-Head-Commit`.
- **The Worker checks only cheap things**: the key hash, `sha256(X-Repo-Url) === :repoHash`, URL and OID formats,
  `Content-Length` of 10 MB or less, and the head commit in the host's refs (I/O, not CPU). It streams the body into R2
  unparsed.
- **Read**: unchanged. On a local cache miss, `GET /cache/v1/:repoHash`, validated on the client.
- **Trust**: a key holder can publish anything for any repo. That's acceptable for a handful of known people, and a key
  can be revoked by removing its hash from the secret.

### Exact incremental refresh

The days a commit lands in depend on its author date, so merging an old PR changes past days. The refresh handles this
by rewinding:

1. Fetch into the persisted clone. If HEAD didn't move, stop.
2. If the cached HEAD isn't an ancestor of the new HEAD (history was rewritten), or `.mailmap` or `engineVersion`
   changed, recompute everything from the local clone. No re-clone is needed.
3. New commits are the ones reachable from the new HEAD but not from the cached HEAD. The earliest affected day is the
   earliest author date among them.
4. Keep the cached days before that day as they are. Seed the state with a full-tree count of the last commit before
   that day, plus that day's cumulative contributors. Then process forward to the new HEAD.

Without a local clone (another device, or a cleared browser), the refresh clones first and then rewinds the same way.
The clone still costs bandwidth, but counting stays limited to the affected days.

**Auto roll-on**: when a cached result opens, a cheap refs lookup checks the remote HEAD. If it moved, the refresh
starts automatically, with the chart staying visible and progress shown.

### Result fields

- `AnalysisResult.engineVersion`: bumped when counting or bucketing rules change. A mismatch forces a full recompute.
- `AnalysisResult.mailmapOid`: the `.mailmap` blob at HEAD. If it changes, author normalization changes for all of
  history.

## Next

1. **Cross-device refresh without a clone.** The phone has the laptop's shared result but no clone, so today's refresh
   clones the whole repo. Plan:
    - Store resume state next to the result as a separate R2 object: per-file path, git object ID, language, and line
      counts at HEAD, plus folder tree IDs.
    - Fetch only new objects with a hand-built protocol v2 upload-pack request: `want` the new HEAD and `have` the
      cached HEAD, without the `thin-pack` capability.
    - Lazily fetch any older objects needed for per-commit attribution: `want <oid>` with `filter=tree:0`, which GitHub
      and GitLab support for partial clones.
    - Needs a spike first.
2. **Consider a first-parent day model** ("what the default branch looked like that day", bucketed by when commits
   landed). It's append-only, so refreshes never rewind, and it removes branch interleaving from the language state.
   It's a product change (PR work shows on its merge day), so it's David's call.
3. **Add Umami events** for analysis started, finished, served from cache, and rolled on, to see whether this works in
   practice.

## Later: peer verification at scale

Only worth building if anonymous traffic grows enough that strangers would benefit from each other's results. The full
earlier design is in git history (`docs/specs/peer-verified-cache-plan.md`, commit `d1f43ea`). The gist:

- Anonymous uploads stay pending and are never served until verified.
- Promotion needs one matching full analysis from another network, plus K spot-checks. A spot-check is a random
  visitor's browser counting one day's commit snapshot and checking that day's messages and authors.
- Tasks are opaque, single-use, and network-bound, with known-answer canary tasks mixed in.
- Prerequisites: per-day commit OIDs, tree-pure classification (done: `.h` follows each commit's own tree), and a
  canonical serialization.
- **The free-plan constraint changes the earlier design**: the Worker can't parse results. So all content checks run in
  voters' browsers, and the Worker only stores blobs and keeps the vote ledger (D1 free tier).

## Task list

### Milestone 1: trusted-device sharing

- [x] Create the R2 bucket `git-strata-results`; set `WRITE_KEY_HASHES`; store David's key in sops
- [x] Worker: key-gated PUT with header checks and unparsed streaming to R2; remove body validation and the old token
- [x] Client: write key storage, `#write-key=` handoff, popup row, upload gating, no uploads for private repos
- [x] CI: drop `PUBLIC_CACHE_WRITE_TOKEN`, set `PUBLIC_SHARED_CACHE_URL`
- [x] Tests, docs (`cors-proxy/CLAUDE.md`, `src/lib/CLAUDE.md`, `docs/deploying.md`)

### Milestone 2: exact incremental refresh

- [x] Rewind-based `analyzeIncremental` with ancestry, `.mailmap`, and engine-version fallbacks
- [x] Shared processing function for full and seeded runs
- [x] Refresh uses it, cloning first when there's no local clone; auto roll-on when the remote HEAD moved
- [x] Equivalence test: incremental after new commits (including a back-dated merge) equals a full analysis
- [x] Docs (`src/lib/CLAUDE.md`)
- [x] Tree-pure `.h` classification (C++ only while the tree has `.cpp`-style files), engine version 2, roll-on and
      cache-independence tests

### Milestone 3: land and verify

- [x] Merge both branches, run the narrow checks, push, and confirm CI deploys the frontend and the proxy
- [ ] Hand off the key to the laptop and phone; check that the phone gets `vdavid/cmdr` instantly
