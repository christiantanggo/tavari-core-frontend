alter table if exists music_tracks
  add column if not exists file_size bigint;

