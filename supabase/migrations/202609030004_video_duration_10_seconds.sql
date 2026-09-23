begin;

-- Replace only the media duration rule; existing media and ownership stay intact.
alter table public.forge_media drop constraint if exists forge_media_check;
alter table public.forge_media drop constraint if exists forge_media_duration_check;
alter table public.forge_media add constraint forge_media_duration_check
  check ((kind = 'image' and duration_seconds is null)
    or (kind = 'video' and duration_seconds > 0 and duration_seconds <= 10));

commit;
