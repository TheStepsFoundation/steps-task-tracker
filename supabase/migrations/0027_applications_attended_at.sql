-- ---------------------------------------------------------------------------
-- 0027_applications_attended_at.sql
--
-- Adds a real timestamp for when a student was checked in to an event.
--
-- Why a separate column rather than reusing updated_at: updated_at gets bumped
-- by every status / internal-review / bonus-points edit, so it can't tell
-- "marked attended at X" apart from "the reviewer flipped a flag". The QR
-- check-in flow needs a reliable "was this student already scanned, and when"
-- signal so duplicate scans can show "already checked in at HH:MM" instead of
-- silently flipping attended back to false.
--
-- The existing attended boolean stays the source of truth for all queries
-- (students_enriched view, KPI counters, the per-row admin toggle). A
-- BEFORE UPDATE trigger keeps attended_at in sync:
--   - false -> true: set attended_at = now()
--   - true  -> false: set attended_at = null
--   - true  -> true (idempotent flip): leave attended_at as the original
--     timestamp so a re-confirm doesn't reset the moment of arrival.
-- ---------------------------------------------------------------------------

ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS attended_at TIMESTAMPTZ NULL;

-- Backfill: best-effort timestamp for rows already flagged attended.
-- updated_at is the closest signal we have to "when did this state get
-- written". Good enough for the duplicate-scan error message.
UPDATE applications
   SET attended_at = updated_at
 WHERE attended IS TRUE AND attended_at IS NULL;

-- Sync trigger
CREATE OR REPLACE FUNCTION applications_sync_attended_at()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.attended IS DISTINCT FROM OLD.attended THEN
    IF NEW.attended IS TRUE THEN
      NEW.attended_at := now();
    ELSE
      NEW.attended_at := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tg_applications_sync_attended_at ON applications;
CREATE TRIGGER tg_applications_sync_attended_at
BEFORE UPDATE ON applications
FOR EACH ROW
EXECUTE FUNCTION applications_sync_attended_at();

-- Same trigger on insert (rare path — almost no app row is inserted with
-- attended=true, but if one ever is, stamp the timestamp so duplicate
-- detection still works).
CREATE OR REPLACE FUNCTION applications_init_attended_at()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.attended IS TRUE AND NEW.attended_at IS NULL THEN
    NEW.attended_at := now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tg_applications_init_attended_at ON applications;
CREATE TRIGGER tg_applications_init_attended_at
BEFORE INSERT ON applications
FOR EACH ROW
EXECUTE FUNCTION applications_init_attended_at();

-- Index for the duplicate-scan lookup (find recent attended_at by
-- application_id) is overkill — applications.id is already a PK, so the row
-- lookup is O(1). No additional index.
