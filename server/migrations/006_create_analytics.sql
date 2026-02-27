-- Up Migration
CREATE TABLE analytics_daily (
    date DATE NOT NULL,
    metric VARCHAR(100) NOT NULL,
    value BIGINT DEFAULT 0,
    metadata JSONB DEFAULT '{}',
    PRIMARY KEY (date, metric)
);

CREATE INDEX idx_analytics_date ON analytics_daily(date, metric);

-- Down Migration
DROP TABLE IF EXISTS analytics_daily;
