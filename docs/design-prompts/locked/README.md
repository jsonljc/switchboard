# Locked design snapshots

Frozen artifacts from Claude Design (`claude.ai/design`) for the surfaces being redesigned in this batch. Committed to the repo so parallel worktrees and future brainstorming sessions share one source of truth — URL drift, link rot, and snapshot divergence are eliminated by reading from here.

## How to use this lock

When brainstorming a redesign for a specific surface, **point to the locked entrypoint** — never re-fetch the source URL. The original API URLs are recorded in `MANIFEST.md` for provenance only.

For each surface, the implementer reads:

1. The entrypoint HTML file (the final design as it was approved).
2. Its sibling `.jsx` / `.css` files in the same directory (component sources the HTML imports).
3. The chat transcripts under `switchboard/chats/` that the original package README recommends — they show user intent and where the design landed after iteration.

See `switchboard/README.md` for the original handoff instructions from Claude Design.

## Why these are frozen here, not fetched on demand

- Source URLs (`api.anthropic.com/v1/design/h/...`) point to per-mint snapshots. Two URLs to "the same workspace" can return different content if the design was edited between mints. Locking to a specific snapshot makes parallel worktrees consume identical bytes.
- A worktree on a feature branch may run weeks after the URL was generated — the URL is not guaranteed to remain valid.
- Recording SHA-256 of each entrypoint in `MANIFEST.md` lets reviewers detect tampering and lets future re-fetches confirm whether the source has drifted.

## Refreshing the lock

Don't edit files under `switchboard/` directly. If a design changes upstream:

1. Re-fetch the relevant tarball(s) from the URL(s) in `MANIFEST.md`.
2. Replace the surface directory under `switchboard/project/`.
3. Recompute the SHA in `MANIFEST.md`.
4. Update the "fetched" date in the manifest row.
5. Land the refresh as its own commit so reviewers can diff intent.

If a single mint covers multiple surfaces (the common case — see `MANIFEST.md` provenance), use one tarball and update all affected rows in the same commit.

## What's in this directory

```
locked/
├── README.md                          # this file
├── MANIFEST.md                        # surface → entrypoint + source URL + SHA + fetch date
└── switchboard/
    ├── README.md                      # original Claude Design handoff README
    ├── chats/                         # 15 chat transcripts — read for design intent
    └── project/
        ├── agent-home-v3/             # Alex / Riley / Pipeline (shared workspace)
        ├── approvals-v2/              # Approvals
        ├── activity-v2/               # Activity
        ├── reports-v2/                # Reports
        └── mission/                   # Mission Control
```

Other directories from the original tarball (older iterations, scratch, audit experiments, dashboard prototypes) are intentionally excluded — they're not entrypoints for this batch and would obscure the canonical files.
