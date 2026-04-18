# CLAUDE.md — Steps Foundation Intranet

Repo: `github.com/TheStepsFoundation/the-steps-foundation-intranet`

## CRITICAL: File access workflow

**Never read or copy files from the FUSE mount.** The local path under `Claude Projects/` frequently serves truncated or stale contents, causing broken syntax and silent corruption.

**Every session must:**
1. Clone fresh from GitHub to `/tmp/intranet-push` (or similar).
2. Read and write all code in the clone.
3. Commit and push from the clone.
4. If the local mount needs updating, rsync *from* the clone *to* the mount — never the reverse.

This is non-negotiable regardless of how small the change is.

## Stack

Next.js 14 (App Router) + React 18 + TypeScript, Tailwind (dark mode via `class`), Supabase (Postgres + Auth), Vercel auto-deploy on push to `master`.

- Supabase project: `rvspshqltnyormiqaidx.supabase.co`
- RLS enabled on all tables; app enforces permissioning.
- Client-side Supabase SDK only, except `/api/schools` (server route for school search).

## Modules

- **Task Tracker** — board/team/list/workload/calendar/Gantt/Today's Focus views. Lives in `src/app/page.tsx`.
- **Student Database** — student records, school linking, eligibility, engagement scoring. `/students` + `/students/[id]` + `/students/review-schools`.
- **Events Hub** — event overview, applicant management, email templates, status history. `/students/events` + `/students/events/[id]`. Email sending via Google Workspace MCP (`hello@thestepsfoundation.com`).
- **Student Portal** — OTP login, application status dashboard, RSVP. `/student-portal`.
- **Public Apply** — student-facing application forms. `/apply/[slug]`.
- **Campaigns** *(planned)* — outreach and partnership tracking.
- **Admin** *(planned)* — team/permissions/settings.

## Deploy checklist

When changing schema, update all three:
1. Supabase — apply migration (via MCP `apply_migration` or SQL editor).
2. GitHub — push code.
3. Vercel — auto-deploys on push; no manual step.

## Conventions

- `useAuth()` must return safe defaults when context is undefined (prevents React Error #310 during SSR).
- Google OAuth consent screen must be **External + In production**.
- `createdBy` tracks authorship where present.
- Task tracker: archive ≠ done; dragging reassigns but keeps old assignee as collaborator.
- Do **not** reintroduce task "labels" or "blocked by dependencies" without discussion — both were deliberately removed.

## Event shorthand

`#1` Starting Point, `#2` Oxbridge, `#3` Degree Apprenticeship, `#4` Great Lock-In, `#5` Man Group Office Visit.
