-- Voiceover segments anchor to a scene by POSITION (scene rows are recreated when the storyboard
-- is rebuilt, so a scene_id FK would dangle). Plan §8.
ALTER TABLE audio_tracks ADD COLUMN scene_position INTEGER;
CREATE INDEX audio_tracks_by_version ON audio_tracks(version_id, kind);
