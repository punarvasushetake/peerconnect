-- Run this once in Supabase SQL Editor for existing Peer Connect databases.

ALTER TABLE video_sessions
  ADD COLUMN IF NOT EXISTS status VARCHAR(30) NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS declined_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS decline_reason TEXT;

UPDATE video_sessions
SET status = CASE
  WHEN ended_at IS NOT NULL THEN 'ended'
  WHEN started_at IS NOT NULL THEN 'accepted'
  ELSE 'pending'
END
WHERE status IS NULL OR status = 'pending';

CREATE INDEX IF NOT EXISTS idx_video_sessions_status ON video_sessions(status);
CREATE INDEX IF NOT EXISTS idx_video_sessions_expires_at ON video_sessions(expires_at);

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type VARCHAR(80) NOT NULL,
  title VARCHAR(200) NOT NULL,
  message TEXT,
  entity_type VARCHAR(80),
  entity_id UUID,
  metadata JSONB NOT NULL DEFAULT '{}',
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id, read_at);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access" ON notifications;
CREATE POLICY "Service role full access" ON notifications FOR ALL USING (true) WITH CHECK (true);
