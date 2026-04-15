-- Smarter raw → GIAS matching:
--   1. Alias dictionary expands abbreviations (KEVI → King Edward VI) before scoring,
--      via school_match_expand().
--   2. school_match_core() strips suffix noise (Sixth Form / School / Academy /
--      College / The / for / of / and) so "John Masefield High School & Sixth Form"
--      scores 1.0 against "John Masefield High School".
--   3. First-token boost in unlinked_school_review: if the raw's first distinctive
--      token (≥5 chars) matches a school strongly, bubble that school up — this is
--      what rescues "Kendrick Reading" → Kendrick School. Coefficient 0.85 keeps the
--      runner-up noise (e.g. "John Mason School") visibly below true matches at 1.0.

CREATE TABLE IF NOT EXISTS public.school_name_aliases (
  alias text PRIMARY KEY,
  expansion text NOT NULL
);

INSERT INTO public.school_name_aliases (alias, expansion) VALUES
  ('kevi',    'king edward vi'),
  ('keviccc', 'king edward vi'),
  ('keviths', 'king edward vi'),
  ('kgs',     'kingston grammar'),
  ('rgs',     'royal grammar'),
  ('qegs',    'queen elizabeths grammar'),
  ('jags',    'james allens girls'),
  ('cls',     'city of london'),
  ('clsg',    'city of london girls'),
  ('hbs',     'haberdashers'),
  ('hsdc',    'havant and south downs')
ON CONFLICT (alias) DO NOTHING;

CREATE OR REPLACE FUNCTION public.school_match_core(s text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT btrim(regexp_replace(
    regexp_replace(
      coalesce(s, ''),
      '\m(the|sixth form|6th form|sixth|6th|school|high|academy|college|centre|center|for|of|and)\M',
      ' ', 'g'
    ),
    '\s+', ' ', 'g'
  ));
$$;

CREATE OR REPLACE FUNCTION public.school_match_expand(raw text)
RETURNS text
LANGUAGE plpgsql STABLE PARALLEL SAFE AS $$
DECLARE
  s text := public.norm_school_name(raw);
  rec record;
BEGIN
  FOR rec IN SELECT alias, expansion FROM public.school_name_aliases LOOP
    s := regexp_replace(s, '\m' || rec.alias || '\M', rec.expansion, 'gi');
  END LOOP;
  RETURN btrim(regexp_replace(s, '\s+', ' ', 'g'));
END
$$;

GRANT EXECUTE ON FUNCTION public.school_match_core(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.school_match_expand(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.unlinked_school_review(
  per_raw integer DEFAULT 6,
  page_size integer DEFAULT 25,
  page_offset integer DEFAULT 0
)
RETURNS TABLE(
  raw text, student_count integer, student_ids uuid[],
  candidates jsonb, total_count integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = 'public' AS $fn$
  WITH grouped AS (
    SELECT btrim(school_name_raw) AS raw,
           COUNT(*)::int AS student_count,
           array_agg(id) AS student_ids
    FROM public.students
    WHERE school_id IS NULL
      AND school_review_dismissed = false
      AND school_name_raw IS NOT NULL
      AND btrim(school_name_raw) <> ''
    GROUP BY btrim(school_name_raw)
  ),
  unlinked AS (
    SELECT raw,
           public.school_match_expand(raw) AS raw_exp,
           public.school_match_core(public.school_match_expand(raw)) AS raw_core,
           student_count,
           student_ids
    FROM grouped
  ),
  total AS (SELECT COUNT(*)::int AS n FROM unlinked),
  page AS (
    SELECT * FROM unlinked
    ORDER BY student_count DESC, lower(raw)
    LIMIT GREATEST(1, LEAST(page_size, 100)) OFFSET GREATEST(0, page_offset)
  ),
  page_aug AS (
    SELECT *,
      CASE WHEN length(split_part(raw_core, ' ', 1)) >= 5
           THEN split_part(raw_core, ' ', 1) ELSE NULL END AS first_tok
    FROM page
  )
  SELECT p.raw, p.student_count, p.student_ids,
    COALESCE((
      SELECT jsonb_agg(to_jsonb(c) ORDER BY c.rnk)
      FROM (
        SELECT s.id, s.name, s.town, s.postcode, s.phase, s.type_group, s.local_authority,
               round(GREATEST(
                 similarity(s.name_norm, p.raw_exp),
                 word_similarity(p.raw_exp, s.name_norm),
                 similarity(public.school_match_core(s.name_norm), p.raw_core),
                 word_similarity(p.raw_core, s.name_norm),
                 CASE WHEN p.first_tok IS NOT NULL
                      THEN word_similarity(p.first_tok, s.name_norm) * 0.85
                      ELSE 0 END
               )::numeric, 3) AS similarity,
               ROW_NUMBER() OVER (
                 ORDER BY GREATEST(
                   similarity(s.name_norm, p.raw_exp),
                   word_similarity(p.raw_exp, s.name_norm),
                   similarity(public.school_match_core(s.name_norm), p.raw_core),
                   word_similarity(p.raw_core, s.name_norm),
                   CASE WHEN p.first_tok IS NOT NULL
                        THEN word_similarity(p.first_tok, s.name_norm) * 0.85
                        ELSE 0 END
                 ) DESC,
                 length(s.name) ASC
               ) AS rnk
        FROM public.schools s
        WHERE s.name_norm <<% p.raw_exp
           OR p.raw_exp <% s.name_norm
           OR s.name_norm <<% p.raw_core
        ORDER BY GREATEST(
                   similarity(s.name_norm, p.raw_exp),
                   word_similarity(p.raw_exp, s.name_norm),
                   similarity(public.school_match_core(s.name_norm), p.raw_core),
                   word_similarity(p.raw_core, s.name_norm),
                   CASE WHEN p.first_tok IS NOT NULL
                        THEN word_similarity(p.first_tok, s.name_norm) * 0.85
                        ELSE 0 END
                 ) DESC,
                 length(s.name) ASC
        LIMIT per_raw
      ) c
    ), '[]'::jsonb) AS candidates,
    (SELECT n FROM total) AS total_count
  FROM page_aug p
  ORDER BY p.student_count DESC, lower(p.raw)
$fn$;

CREATE OR REPLACE FUNCTION public.search_schools(q text, lim integer DEFAULT 15)
RETURNS TABLE(
  id uuid, urn integer, name text, town text, postcode text,
  phase text, type_group text, local_authority text, similarity real
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = 'public' AS $fn$
  WITH q_norm AS (
    SELECT btrim(q) AS qq,
           public.school_match_expand(q) AS qe,
           public.school_match_core(public.school_match_expand(q)) AS qc
  )
  SELECT s.id, s.urn, s.name, s.town, s.postcode, s.phase, s.type_group, s.local_authority,
         GREATEST(
           similarity(s.name_norm, qn.qe),
           word_similarity(qn.qe, s.name_norm),
           similarity(public.school_match_core(s.name_norm), qn.qc),
           word_similarity(qn.qc, s.name_norm)
         )::real AS similarity
  FROM public.schools s, q_norm qn
  WHERE qn.qq <> ''
    AND (s.name_norm % qn.qe OR s.name_norm <<% qn.qe OR qn.qe <% s.name_norm
         OR s.name_norm <<% qn.qc)
  ORDER BY (s.name_norm = qn.qe) DESC,
           GREATEST(
             similarity(s.name_norm, qn.qe),
             word_similarity(qn.qe, s.name_norm),
             similarity(public.school_match_core(s.name_norm), qn.qc),
             word_similarity(qn.qc, s.name_norm)
           ) DESC,
           length(s.name) ASC
  LIMIT GREATEST(1, LEAST(lim, 50));
$fn$;
