-- +goose Up

-- 刷新令牌轮转（rotate on use）：每次刷新插入新行、旧行保留为重用检测的墓碑
--（拿到已撤销行的哈希 = 有人重放旧令牌 = 疑似泄露，撤销该用户全部会话）。
-- chain_id 标识「一次登录」产生的整条链；访问令牌的 sid 引用 chain_id，
-- 这样轮换之后 logout / 改密仍能准确定位当前会话链。
ALTER TABLE sessions ADD COLUMN chain_id uuid NOT NULL DEFAULT gen_random_uuid();

-- 按链撤销（logout）、按用户撤销（logout-all / 重用检测 / 改密）都走
-- sessions_user_idx；这里补 logout 用的链索引。
CREATE INDEX sessions_chain_idx ON sessions (chain_id) WHERE revoked_at IS NULL;

-- +goose Down
DROP INDEX IF EXISTS sessions_chain_idx;
ALTER TABLE sessions DROP COLUMN IF EXISTS chain_id;
