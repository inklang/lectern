-- Enhance download_logs with country and referrer tracking
-- Safe additive migration: no existing data modified

ALTER TABLE download_logs ADD COLUMN IF NOT EXISTS country TEXT;
ALTER TABLE download_logs ADD COLUMN IF NOT EXISTS referrer TEXT;

-- Indexes for analytics query performance
CREATE INDEX IF NOT EXISTS idx_download_logs_country ON download_logs(country);
CREATE INDEX IF NOT EXISTS idx_download_logs_referrer ON download_logs(referrer);
CREATE INDEX IF NOT EXISTS idx_download_logs_package_downloaded ON download_logs(package_name, downloaded_at);
CREATE INDEX IF NOT EXISTS idx_download_logs_package_version ON download_logs(package_name, version);
