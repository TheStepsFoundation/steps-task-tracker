-- =============================================================================
-- Steps Intranet — Re-apply with previous answers pre-filled
-- Date: 2026-05-18
--
-- Background:
--   When a student withdraws an application, the row is soft-deleted
--   (deleted_at IS NOT NULL, status = 'withdrew'). RLS policy
--   applications_self_select hides soft-deleted rows from the student, so
--   the apply form can't read their old raw_response to pre-fill.
--
-- This migration adds a SECURITY DEFINER RPC that returns ONLY the
-- presentation fields needed to rehydrate the apply form, restricted to
-- the calling student (matched on JWT email -> students.personal_email).
-- It does not leak any data the student couldn't already see when the
-- application was live.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_latest_withdrawn_application(p_event_id uuid)
RETURNS TABLE (
  id uuid,
  raw_response jsonb,
  attribution_source text,
  channel text,
  withdrawn_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    a.id,
    a.raw_response,
    a.attribution_source,
    a.channel,
    a.deleted_at AS withdrawn_at
  FROM public.applications a
  JOIN public.students s ON s.id = a.student_id
  WHERE a.event_id = p_event_id
    AND a.status = 'withdrew'
    AND a.deleted_at IS NOT NULL
    AND s.personal_email = lower(auth.jwt() ->> 'email')
  ORDER BY a.deleted_at DESC NULLS LAST
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_latest_withdrawn_application(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_latest_withdrawn_application(uuid) TO authenticated;

COMMENT ON FUNCTION public.get_latest_withdrawn_application(uuid) IS
  'Returns the raw_response of the calling student''s most recent soft-deleted+withdrew application for the given event, so the apply form can pre-fill answers when the student re-applies. Read-only; restricted to the JWT-matched student.';

-- -----------------------------------------------------------------------------
-- Formalise withdraw_application RPC.
--
-- Created originally via the Supabase dashboard during the Man Group launch;
-- re-create here so it lives in the migration history and survives a fresh
-- environment / restore. CREATE OR REPLACE is idempotent.
--
-- Behaviour: sets status='withdrew', stamps deleted_at, writes the status
-- transition to application_status_history. Restricted to the JWT-matched
-- student so a student can only withdraw their OWN application.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.withdraw_application(p_application_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_status text;
  v_student_email text;
  v_caller_email text := lower(auth.jwt() ->> 'email');
BEGIN
  IF v_caller_email IS NULL OR v_caller_email = '' THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT a.status, s.personal_email
    INTO v_old_status, v_student_email
  FROM public.applications a
  JOIN public.students s ON s.id = a.student_id
  WHERE a.id = p_application_id
    AND a.deleted_at IS NULL;

  IF NOT FOUND THEN
    -- Already withdrawn (soft-deleted) or wrong id — treat as idempotent no-op.
    RETURN;
  END IF;

  IF v_student_email <> v_caller_email THEN
    RAISE EXCEPTION 'Not authorised to withdraw this application' USING ERRCODE = '42501';
  END IF;

  UPDATE public.applications
     SET status = 'withdrew',
         deleted_at = now(),
         updated_at = now()
   WHERE id = p_application_id;

  -- Best-effort transition log. If the history table or trigger handles
  -- this elsewhere, the INSERT will simply duplicate the row — acceptable
  -- given the audit timeline is append-only anyway.
  BEGIN
    INSERT INTO public.application_status_history (application_id, old_status, new_status, changed_by)
    VALUES (p_application_id, v_old_status, 'withdrew', NULL);
  EXCEPTION WHEN OTHERS THEN
    -- swallow — withdrawal is the primary action, history is best-effort
    NULL;
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.withdraw_application(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.withdraw_application(uuid) TO authenticated;

COMMENT ON FUNCTION public.withdraw_application(uuid) IS
  'Student-initiated withdrawal. Sets status=withdrew and stamps deleted_at so the partial unique index (applications_student_event_live_uniq) frees up the slot, letting the student re-apply. Restricted to the JWT-matched student.';
