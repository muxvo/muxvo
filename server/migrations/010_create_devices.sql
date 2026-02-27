-- Up
CREATE TABLE devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id VARCHAR(36) NOT NULL UNIQUE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  name VARCHAR(100),
  platform VARCHAR(20),
  arch VARCHAR(20),
  os_version VARCHAR(50),
  app_version VARCHAR(20),
  hostname VARCHAR(100),
  last_ip VARCHAR(45),
  status VARCHAR(20) DEFAULT 'active',
  first_seen_at TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_devices_user ON devices(user_id);
CREATE INDEX idx_devices_status ON devices(status);

-- Down
DROP TABLE IF EXISTS devices;
