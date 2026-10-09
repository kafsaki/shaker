-- +goose Up

-- 弃用「不列出(unlisted)」：分享改用直接分享 /menus/{id} 链接，不再需要
-- 「公开可见但仅持链接者能访问」这一档。可见性收敛为 public/private 两值。
-- 存量 unlisted 一律转 private（语义上更保守，不会意外扩大可见范围）。

-- menus_touch 会在 UPDATE 时刷新 updated_at，而可见性迁移不是用户行为，
-- 屏蔽触发器以免打乱所有酒单的 updated_at 排序。
ALTER TABLE menus DISABLE TRIGGER menus_touch;
UPDATE menus SET visibility = 'private' WHERE visibility = 'unlisted';
ALTER TABLE menus ENABLE TRIGGER menus_touch;

-- PG 不支持删除枚举值，只能重建类型（列用 text 中转转换）。
-- menus_public_idx 的部分索引谓词引用了旧枚举类型（'public'::menu_visibility），
-- 类型重建会因找不到「新类型 = 旧类型」的比较算子而失败，先删后建。
DROP INDEX IF EXISTS menus_public_idx;
ALTER TABLE menus ALTER COLUMN visibility DROP DEFAULT;
ALTER TYPE menu_visibility RENAME TO menu_visibility_old;
CREATE TYPE menu_visibility AS ENUM ('public', 'private');
ALTER TABLE menus ALTER COLUMN visibility TYPE menu_visibility
  USING (visibility::text::menu_visibility);
ALTER TABLE menus ALTER COLUMN visibility SET DEFAULT 'private';
DROP TYPE menu_visibility_old;
CREATE INDEX menus_public_idx ON menus (updated_at DESC)
  WHERE visibility = 'public' AND deleted_at IS NULL;

-- 分享令牌作废。
DROP INDEX IF EXISTS menus_share_token_key;
ALTER TABLE menus DROP COLUMN share_token;

-- +goose Down

ALTER TABLE menus ADD COLUMN share_token text;
CREATE UNIQUE INDEX menus_share_token_key ON menus (share_token) WHERE share_token IS NOT NULL;

DROP INDEX IF EXISTS menus_public_idx;
ALTER TABLE menus ALTER COLUMN visibility DROP DEFAULT;
ALTER TYPE menu_visibility RENAME TO menu_visibility_new;
CREATE TYPE menu_visibility AS ENUM ('public', 'unlisted', 'private');
ALTER TABLE menus ALTER COLUMN visibility TYPE menu_visibility
  USING (visibility::text::menu_visibility);
ALTER TABLE menus ALTER COLUMN visibility SET DEFAULT 'private';
DROP TYPE menu_visibility_new;
CREATE INDEX menus_public_idx ON menus (updated_at DESC)
  WHERE visibility = 'public' AND deleted_at IS NULL;