-- Up Migration
CREATE TABLE user_identities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider VARCHAR(50) NOT NULL,
    provider_id VARCHAR(255) NOT NULL,
    provider_data JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(provider, provider_id)
);

CREATE INDEX idx_identities_provider ON user_identities(provider, provider_id);
CREATE INDEX idx_identities_user ON user_identities(user_id);

-- Down Migration
DROP TABLE IF EXISTS user_identities;
