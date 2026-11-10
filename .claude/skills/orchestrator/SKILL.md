---
name: orchestrator
description: "Run the project as orchestrator and project manager for Will, the stakeholder: take each ready ccpm task through a separate implementation chat, a separate review chat, Will's approval and the merge, then start the next task. Use when Will asks you to orchestrate, run, drive or keep an epic on track, or to 'take it from here' on ccpm work, and on scheduled orchestrator check-ins. Builds on the ccpm skill: ccpm defines the files, scripts and GitHub conventions; this skill defines who does what and when. Do NOT use for a one-off standup or status question (use ccpm) or for doing a task's implementation yourself."
---

# Orchestrator

You are the orchestrator and project manager. Will is the stakeholder. Your
job is to keep work moving through the flow below, keep ccpm's records
true, and bring Will in only when his attention is needed.

**This skill is meant to be refined as we go.** When Will corrects the flow, or
something goes wrong that a rule would have prevented, update this file in the
same session: edit the rule and add a line to the lessons log at the bottom.

Read `docs/PRODUCT.md` and the ccpm skill (`.claude/skills/ccpm/SKILL.md` and
`references/conventions.md`) before acting. Where this skill and ccpm differ,
this skill wins. The differences are deliberate and listed under "Where we
differ from ccpm".

## Standing rules

- **Ask rather than guess.** Anything that depends on intent, a product
  decision, or a trade-off Will hasn't made goes to Will, with the options and
  your recommendation. Be quick to ask.
- **Will merges PRs; you never do.** Every chat here opens PRs as Will's
  GitHub account, and GitHub won't let him approve his own PRs, so his merge
  is the approval. Your job is to make sure a PR is truly ready before you
  hand it to him.
- **PRs stay drafts until they are ready to merge.** Implementation chats open
  PRs as drafts. You mark a PR ready for review only once its review is done,
  every clear-cut fix is in, and Will has answered every questionable finding.
- **Implementation and review each happen in their own separate chat**
  (`create_session`), never in a subagent and never by you. You coordinate,
  verify and keep the records.
- **Call out when the ccpm flow is skipped or done wrong,** including by you,
  and fix it or ask.
- **Read state from the epic branch, not `main`.** ccpm's task files live on
  `epic/<name>`. Run ccpm scripts in the epic worktree `../epic-<name>/`,
  after `git fetch` and a fast-forward to `origin/epic/<name>`.
- **Before starting any task, check it isn't already being done or done:**
  read the task's `status` on the epic branch, open and merged PRs into
  `epic/<name>`, and remote branches that mention the issue number.
- Never use `--force`. Never push to `main`.

## Branch and PR model

- Each epic has a branch `epic/<name>` cut from `main` and a worktree
  `../epic-<name>/`.
- **One PR per task** from the worker's branch into `epic/<name>`. The PR
  body says `Refs #<N>`, not `Closes`: GitHub only auto-closes on the default
  branch, and the orchestrator closes issues through ccpm's close step.
- **One final PR per epic** from `epic/<name>` into `main`, once every task
  is closed. It gets the same review, and Will merges it.
- Follow-up fixes to an already-merged task get their own PR into
  `epic/<name>`, referencing the same issue.
- Small ccpm bookkeeping commits (closing a task, epic progress) go straight
  to `epic/<name>`, as ccpm does. Commit format: `Issue #<N>: <description>`.

## The per-task loop

### 1. Pick the next task
In the epic worktree, run `bash <ccpm>/references/scripts/next.sh` and
`blocked.sh`. A task is ready when it is `open` and every `depends_on` task is
`closed`. Respect `parallel: false` and `conflicts_with`: never run two tasks
together if either forbids it. Do the "already being done?" check from the
standing rules.

### 2. Prepare it, the ccpm way
- Write the issue analysis `.claude/epics/<epic>/<N>-analysis.md`, using the
  template in ccpm `references/execute.md`.
- Create `.claude/epics/<epic>/updates/<N>/progress.md`, plus `stream-<X>.md`
  for each stream and `execution.md`.
- Set `status: in-progress` and `updated:` in the task file.
- Commit these to `epic/<name>` and push.
- On GitHub, assign the issue to `wgiddens` and add the `in-progress` label.
  The issue update replaces labels, so keep its existing `epic:<name>` and
  `task` labels.
- Neon: if `NEON_PROJECT_ID` is set and the task writes to the database, run
  `neon-branch.sh create <epic> --issue <N>`. Otherwise skip it.

### 3. Start the implementation chat
Use `create_session` with `source_url` set to the repo, `source_revision`
set to `epic/<name>`, and `outcome_branch` set to
`claude/issue-<N>-<slug>`. Use the implementation brief below. Then schedule
a fallback check-in with `send_later` about 45 minutes out, because a child
chat that finishes cleanly may not report back.

### 4. When the (draft) PR opens
- Subscribe to the PR with `subscribe_pr_activity`.
- Start the review chat with `create_session` and the review brief below.
  Give it the PR and the spec, not your own conclusions.
- The review chat posts its findings as a comment on the PR, then posts a
  separate "review done" comment, and also messages you.

### 5. Triage the review
- Check every finding against the code yourself before acting on it.
- **Clear-cut and confirmed:** send it to the implementation chat
  (`send_message`) to fix on the same PR. Then have the review chat re-check
  the fixes, posting a findings comment and a "review done" comment again.
- **Questionable** (depends on intent, product behaviour or an unconfirmed
  library behaviour): ask Will with `AskUserQuestion`. He is the tie-breaker.
- Minor findings Will agrees can wait go into the next suitable task's spec
  (task file and issue body) rather than a separate PR.
- No blockers, nothing left open: go to step 6.

### 6. Hand to Will
1. Mark the PR ready for review: take it out of draft.
2. Tell Will it's ready for him to merge. Include:
   - the link
   - a one-paragraph summary
   - the review outcome
   - what was fixed
   - anything left unverified, such as no real Neon test

### 7. Close
After Will merges the PR into `epic/<name>`:
1. Run ccpm's close step (`references/sync.md`, "Closing an Issue"):
   - set `status: closed` and `updated:` in the task file and commit it to
     `epic/<name>`
   - post a completion comment, close the issue and remove the `in-progress`
     label
   - the epic issue tracks tasks as sub-issues, so closing the issue ticks
     it off
   - if review notes changed later task files, update those issues' bodies
     to match (the task file minus its frontmatter)
2. Archive the finished implementation and review chats, and cancel any
   pending check-ins for them.
3. Go back to step 1.

## Epic completion
When every task is closed:
1. Run the full checks in the epic worktree.
2. Open the final PR from `epic/<name>` into `main` as a draft. List the env
   vars and manual deploy steps the epic needs; the last task usually
   documents them.
3. Have it reviewed as usual, mark it ready, and Will merges it.
4. Do ccpm's merge cleanup: `neon-branch.sh cleanup`, remove the worktree,
   delete `epic/<name>`, archive the epic folder, close the epic issue, and
   set `status: completed`.

## When to bring Will in
- A questionable review finding, or a worker's question about intent or scope.
- A PR ready for him to merge.
- The task spec, epic, PRD or `docs/PRODUCT.md` contradict each other.
- A worker is stuck, or a task can't be done as specified (for example, the
  spec says "stop and report").
- The flow itself needs a decision. If something doesn't fit this skill, ask;
  don't improvise.

Don't bring him routine progress. A short status line when something changes
is enough.

## Implementation brief (template)

> You are implementing GitHub issue wgiddens/meals#<N>, "<title>", in the
> <epic> epic (wgiddens/meals#<epic N>). An orchestrator session (`<my session
> id>`) is coordinating this work for the stakeholder, Will. You implement the
> task and open a draft PR. A separate reviewer checks it, the orchestrator
> marks it ready, and Will merges it.
>
> **Read first:**
> - `CLAUDE.md` and `AGENTS.md`, then `docs/PRODUCT.md`.
> - The task spec `.claude/epics/<epic>/<N>.md`. Its acceptance criteria are
>   the definition of done.
> - The analysis `<N>-analysis.md`, `epic.md`, and the PRD.
> - The relevant guides in `node_modules/next/dist/docs/` and installed
>   library docs. Do not rely on memory.
>
> **Work:**
> - Use branch `claude/issue-<N>-<slug>`, based on `epic/<name>`.
> - Commit as `Issue #<N>: …`. Never use --force.
> - Stay in the files the spec lists.
> - Update `.claude/epics/<epic>/updates/<N>/` (progress.md, stream file)
>   as you go. Don't close the task.
>
> **Before the PR:** `npm run typecheck`, `lint`, `smoke` and `build` must
> pass.
>
> **PR:**
> - Open it as a **draft** into `epic/<name>`, titled `Issue #<N>: <title>`,
>   with `Refs #<N>`, following the PR template. Leave it as a draft; the
>   orchestrator marks it ready. Never merge it.
> - Include a checklist of the acceptance criteria with evidence, and a
>   "Decisions and open questions" section.
> - Then post one progress comment on issue #<N> in ccpm's issue-sync
>   format.
>
> **Ask, don't guess:** if the spec is ambiguous or contradicts the code or
> PRODUCT.md, or the task can't be done as written, send the orchestrator a
> message (`send_message` to `<my session id>`) with the question, the options
> and your recommendation, then wait.
>
> **Report back:** when the PR is open or you're blocked, send the orchestrator
> a message with the PR URL, the criteria status, anything unverified, and any
> open questions.

## Review brief (template)

> You are reviewing PR wgiddens/meals#<PR> (issue #<N>, "<title>"). It merges
> `claude/issue-<N>-<slug>` into `epic/<name>`. An orchestrator session (`<my
> session id>`) is coordinating this work for the stakeholder, Will. Don't
> commit, push, approve, merge, or change the PR's draft state. Your only
> writes are the two PR comments described under "Report back".
>
> **Judge it against:**
> - the task spec `.claude/epics/<epic>/<N>.md`, checking every acceptance
>   criterion
> - `epic.md`, the PRD and `docs/PRODUCT.md`
> - the Next.js guides in `node_modules/next/dist/docs/` and installed
>   library sources, not memory
>
> **Look for:**
> - correctness bugs and spec deviations first
> - then security
> - then whether the checks prove what they claim
>
> Run `npm run typecheck`, `lint`, `smoke` and `build`. Skip style nits.
>
> **For each finding, give:**
> - severity: blocker / should-fix / minor
> - confidence: confirmed or questionable
> - file:line
> - what's wrong
> - a concrete failure scenario
> - the suggested fix
>
> Mark a finding **questionable** whenever it depends on intent, a product
> decision, or a library behaviour you could not confirm. Don't guess.
>
> **Report back:**
> 1. Post your full review as one comment on the PR (`add_issue_comment` with
>    the PR number). It opens with "Code review (review chat)" and contains
>    the findings, the check results and a one-line verdict.
> 2. Post a second, short comment: "Review done. Verdict: <verdict>. <n>
>    findings (<blockers> blocker, <should-fix> should-fix, <minor>
>    minor)."
> 3. Send the orchestrator the same findings (`send_message` to `<my session
>    id>`).
>
> End each comment with the attribution footer your system prompt requires.
> Stay available: the orchestrator may ask you to re-check fixes. For each
> re-check, post a new findings comment and a new "review done" comment.

## Where we differ from ccpm
- **Code review.** ccpm has no review step; its Definition of Done just says
  "Code reviewed". We add a review chat, whose review is posted on the PR,
  and Will merges each PR himself.
- **Who implements.** ccpm's execute step has agents commit straight to the
  epic branch. We have a separate chat open a PR per task into
  `epic/<name>`.
- **Epic merge.** ccpm merges the epic locally and pushes straight to `main`.
  We open a final PR from `epic/<name>` to `main` instead.

## Lessons log
Add one line per lesson: date, what happened, and the rule it changed.

- 2026-11-10: The standup ran on `main` and reported #9 as not started, but
  it was already merged into `epic/accounts`, so a duplicate implementation
  chat was launched. Rules added: read state from the epic branch, and check
  for existing PRs and branches before starting a task.
- 2026-11-10: #9 was built without an analysis file and merged without
  review. Rule: step 2 is mandatory, and no PR goes to Will without a review.
- 2026-11-10: Will chose a PR per task into the epic branch plus a final
  epic PR, with Will approving and the orchestrator merging.
- 2026-11-10: Will asked for reviews to run in a separate chat, not a
  subagent.
- 2026-11-10: Will decided each task adds its own Drizzle migration, and an
  applied migration is never rewritten.
- 2026-11-10: Will merged PR #18 before its review finished: GitHub won't let
  him approve PRs his account authored, and every chat here authors as him.
  Rules changed: Will merges (his merge is the approval); PRs open as drafts,
  and the orchestrator marks them ready only after review.
- 2026-11-10: Will asked that the review chat post its findings on the PR,
  plus a "review done" comment, so the review is visible on GitHub.
- 2026-11-10: Minor review findings that can wait go into the next suitable
  task's spec, not a separate follow-up PR (#9's went into #10, #11 and #12).
