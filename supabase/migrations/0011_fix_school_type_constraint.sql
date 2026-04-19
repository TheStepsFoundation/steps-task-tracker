-- Fix school_type CHECK constraint to allow 'independent' (was only state/grammar/private)
-- Also remove first_generation_uni requirement since our target audience (Y12/Y13) hasn't attended uni yet

ALTER TABLE public.students DROP CONSTRAINT IF EXISTS students_school_type_check;
ALTER TABLE public.students ADD CONSTRAINT students_school_type_check
  CHECK (school_type = ANY (ARRAY['state', 'grammar', 'private', 'independent']));
