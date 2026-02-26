-- Up

-- Analytics events table (per-device/user event tracking)
-- Supports hybrid auth: anonymous device_id + optional user_id
CREATE TABLE IF NOT EXISTS analytics_events (
  id BIGSERIAL PRIMARY KEY,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  device_id VARCHAR(36) NOT NULL,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  metric VARCHAR(100) NOT NULL,
  value BIGINT DEFAULT 1,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ae_date_metric ON analytics_events(date, metric);
CREATE INDEX IF NOT EXISTS idx_ae_device ON analytics_events(device_id, date);
CREATE INDEX IF NOT EXISTS idx_ae_user ON analytics_events(user_id, date);

-- Down

DROP TABLE IF EXISTS analytics_events;
