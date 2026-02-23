TfPilot Lifecycle Model V2 — Single Source of Truth
Purpose

This document defines the next-generation lifecycle model for TfPilot.

The goal is to simplify status handling by moving to a derived lifecycle model where request status is computed from runtime facts instead of being manually written across multiple routes.

This reduces complexity, prevents inconsistencies, and improves reliability across UI, API, and metrics.

Problems with current model

The current lifecycle system has multiple sources of truth:

Stored request.status

Derived status via deriveStatus

Overrides in list and sync

Explicit writes across handlers

Destroy states stored separately

This creates risks:

Status drift between pages

Race conditions

Stale UI

Complex sync logic

Hard debugging

Multiple label systems

Timeline inconsistencies

Design principles

Status must be a pure function of runtime facts

Stored status must not be authoritative except for destroy lifecycle

UI must always display derived status

Only one derivation entrypoint

Timeline should be event-driven long term

Lifecycle transitions must be predictable

API routes should not manually set status except for destroy start

Single source of truth

Status will be derived from:

planRun

applyRun

approval

pr

destroyRun

Stored request.status becomes:

👉 lastKnownStatus (optional, informational only)

Lifecycle derivation model

Priority order:

destroyRun in progress → destroying

destroyRun success → destroyed

applyRun failed → failed

planRun failed → failed

applyRun running → applying

applyRun success → applied

PR merged → merged

approval approved → approved

planRun success → plan_ready

planRun running → planning

else → request_created

API behavior changes
Remove explicit status writes from:

plan dispatch

apply dispatch

approve

merge

update

sync

refresh

Only explicit write allowed:

destroy start → set destroyRun.status = in_progress

UI behavior

UI must:

always use derived status

normalize via status-config

never rely on stored status

Timeline behavior

Short term:

Timeline remains projection from derived status + lifecycle logs timestamps.

Long term:

Timeline becomes event-driven.

Metrics behavior

Metrics must compute status using the same derivation function.

Migration strategy

Phase 1 — Introduce unified derivation
Phase 2 — Stop writing status in handlers
Phase 3 — Update UI to trust derived only
Phase 4 — Remove stored status usage
Phase 5 — Clean up legacy logic

Non-goals

No change to request schema except optional rename

No change to workflows

No change to UI appearance initially

Acceptance criteria

Status is consistent across list and detail

No explicit writes except destroy lifecycle

Timeline matches lifecycle

Metrics match UI

Sync logic simplified

Outcome

Lifecycle becomes:

Simple
Predictable
Consistent
Observable

🧠 Execution plan (high level)

This is a refactor but not a rewrite.

You will:

1️⃣ Introduce new derivation
2️⃣ Switch consumers
3️⃣ Remove old writes
4️⃣ Clean up