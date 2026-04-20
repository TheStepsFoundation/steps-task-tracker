-- 0017_drop_private_school_type
--
-- 'private' was a duplicate of 'independent' that crept in earlier. The
-- canonical four school_type values are: state, grammar, independent,
-- independent_bursary. Reclassify all 'private' rows to 'independent'
-- and tighten the CHECK constraint to forbid 'private' going forward.

update public.students
set school_type = 'independent'
where school_type = 'private';

alter table public.students
  drop constraint if exists students_school_type_check;

alter table public.students
  add constraint students_school_type_check
  check (school_type is null or school_type in ('state', 'grammar', 'independent', 'independent_bursary'));
