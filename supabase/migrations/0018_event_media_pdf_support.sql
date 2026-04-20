-- Extend the event-banners storage bucket so the new "media" form field
-- type can accept PDFs as well as images. We reuse the existing bucket
-- (and its RLS policies) rather than spin up a new one so admins don't
-- need a second set of permissions.
--
-- Changes:
--   * file_size_limit bumped from 5 MB -> 10 MB (PDFs tend to be heavier)
--   * allowed_mime_types now includes application/pdf

update storage.buckets
set
  file_size_limit = 10 * 1024 * 1024,
  allowed_mime_types = array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'application/pdf'
  ]
where id = 'event-banners';
