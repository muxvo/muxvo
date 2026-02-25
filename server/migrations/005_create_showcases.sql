-- Up
CREATE TABLE showcases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    skill_name VARCHAR(200) NOT NULL,
    title VARCHAR(300),
    description TEXT,
    score_data JSONB,
    html_content TEXT,
    template_id VARCHAR(50),
    status VARCHAR(20) DEFAULT 'draft',
    slug VARCHAR(200) UNIQUE,
    view_count INT DEFAULT 0,
    published_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE showcase_likes (
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    showcase_id UUID REFERENCES showcases(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, showcase_id)
);

CREATE TABLE showcase_comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    showcase_id UUID REFERENCES showcases(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_showcases_user ON showcases(user_id, status);
CREATE INDEX idx_showcases_slug ON showcases(slug) WHERE status = 'published';
CREATE INDEX idx_showcase_comments_showcase ON showcase_comments(showcase_id);

-- Down
DROP TABLE IF EXISTS showcase_comments;
DROP TABLE IF EXISTS showcase_likes;
DROP TABLE IF EXISTS showcases;
