-- +goose Up

-- 酒单广场（ADR-029）：公开酒单可以被别人收藏、按热度发现；官方精选酒单由种子维护。
--   menus.save_count     被多少人收藏（冗余计数，与 menu_saves 同事务维护）
--   menus.featured_key   官方精选酒单的种子键（seed.json officialMenus[].key），非空即「精选」
--   menus.featured_rank  精选酒单在广场上的展示顺序（种子里的下标）
--   menu_saves           谁收藏了哪个酒单；酒单转私密或删除后收藏行保留，读取时按可见性过滤

ALTER TABLE menus
  ADD COLUMN save_count    integer NOT NULL DEFAULT 0,
  ADD COLUMN featured_key  text,
  ADD COLUMN featured_rank integer;

-- 被收藏不算「酒单更新」：触发器只在内容列变化时刷新 updated_at，
-- 否则每次收藏都会把酒单顶到「最新」、打乱主人自己的列表顺序。
DROP TRIGGER menus_touch ON menus;
CREATE TRIGGER menus_touch
  BEFORE UPDATE OF owner_id, title, description, cover_url, visibility, item_count, deleted_at ON menus
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE UNIQUE INDEX menus_featured_key ON menus (featured_key) WHERE featured_key IS NOT NULL;
CREATE INDEX menus_public_hot_idx ON menus (save_count DESC, updated_at DESC)
  WHERE visibility = 'public' AND deleted_at IS NULL;

CREATE TABLE menu_saves (
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  menu_id    uuid NOT NULL REFERENCES menus(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, menu_id)
);
CREATE INDEX menu_saves_user_idx ON menu_saves (user_id, created_at DESC);
CREATE INDEX menu_saves_menu_idx ON menu_saves (menu_id);

-- +goose Down

DROP TABLE IF EXISTS menu_saves;
DROP TRIGGER menus_touch ON menus;
CREATE TRIGGER menus_touch BEFORE UPDATE ON menus
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
DROP INDEX IF EXISTS menus_public_hot_idx;
DROP INDEX IF EXISTS menus_featured_key;
ALTER TABLE menus DROP COLUMN IF EXISTS featured_rank,
  DROP COLUMN IF EXISTS featured_key, DROP COLUMN IF EXISTS save_count;
