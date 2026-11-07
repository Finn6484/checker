-- ========================================================
-- LINE 定位打卡連勝系統資料庫綱要 (Supabase SQL Editor 專用)
-- ========================================================

-- 1. 群組表 (groups)
CREATE TABLE IF NOT EXISTS groups (
    group_id VARCHAR(100) PRIMARY KEY,
    target_lat DOUBLE PRECISION,
    target_lng DOUBLE PRECISION,
    target_name VARCHAR(255) DEFAULT '打卡基準點',
    member_quota INT DEFAULT 3,           -- 固定打卡小隊名額上限 (例如 3 或 5 人)
    cutoff_time VARCHAR(5) DEFAULT '23:59', -- 每日打卡截止時間 (格式 'HH:mm'，如 '09:30', '18:00', '23:59')
    current_streak INT DEFAULT 0,
    last_streak_date VARCHAR(10),          -- 上次達成全員打卡日期 (格式 'YYYY-MM-DD')
    last_cutoff_report_date VARCHAR(20),   -- 上次發送截止後 5 分鐘即時資料日期
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. 群組小隊成員表 (group_members)
CREATE TABLE IF NOT EXISTS group_members (
    group_id VARCHAR(100) NOT NULL,
    user_id VARCHAR(100) NOT NULL,
    display_name VARCHAR(255) NOT NULL,
    picture_url TEXT,
    is_team_member BOOLEAN DEFAULT TRUE,  -- 是否已加入固定打卡小隊名額
    is_active BOOLEAN DEFAULT TRUE,
    joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    PRIMARY KEY (group_id, user_id)
);

-- 3. 打卡紀錄表 (check_ins)
CREATE TABLE IF NOT EXISTS check_ins (
    id BIGSERIAL PRIMARY KEY,
    group_id VARCHAR(100) NOT NULL,
    user_id VARCHAR(100) NOT NULL,
    check_in_date VARCHAR(10) NOT NULL,    -- 格式：'YYYY-MM-DD' (台灣時區)
    check_in_time TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    lat DOUBLE PRECISION NOT NULL,
    lng DOUBLE PRECISION NOT NULL,
    distance DOUBLE PRECISION NOT NULL,    -- 與目標地點之直線距離 (公尺)
    is_on_time BOOLEAN DEFAULT TRUE,      -- 是否在每日截止時間前完成打卡
    CONSTRAINT unique_daily_checkin UNIQUE (group_id, user_id, check_in_date)
);

-- 索引優化 (提升查詢效能)
CREATE INDEX IF NOT EXISTS idx_checkins_group_date ON check_ins(group_id, check_in_date);
CREATE INDEX IF NOT EXISTS idx_group_members_group ON group_members(group_id);

-- ========================================================
-- Row Level Security (RLS) 設定
-- 允許後端 API (使用 service_role 或 anon key) 進行資料存取
-- ========================================================
ALTER TABLE groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE check_ins ENABLE ROW LEVEL SECURITY;

-- 建立全域存取策略 (適用於本應用之後端 API)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow all access to groups') THEN
        CREATE POLICY "Allow all access to groups" ON groups FOR ALL USING (true) WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow all access to group_members') THEN
        CREATE POLICY "Allow all access to group_members" ON group_members FOR ALL USING (true) WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow all access to check_ins') THEN
        CREATE POLICY "Allow all access to check_ins" ON check_ins FOR ALL USING (true) WITH CHECK (true);
    END IF;
END
$$;
