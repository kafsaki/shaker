-- +goose Up

-- wiki 式维护（ADR-027）：受认证的编辑（editor）可以在站内修订经典配方与原料百科。
--   users.role          user / editor / admin。admin 由 SHAKER_ADMIN_HANDLES 启动时授予，
--                       editor 由 admin 在「编辑部」页授予。
--   *.wiki_edited_at    有人在站内改过这一条 → 种子导入不再覆盖它（seed.json 只管没人碰过的条目）。
--   ingredients.wiki_version  原料词条的乐观锁 + 修订号；0 = 种子原样。
--   recipe_revisions.meta     经典条目修订时的元数据快照（副标题、描述、口味……），
--                             IR 之外的改动也能在历史里看到、拿来回滚。

ALTER TABLE users ADD COLUMN role text NOT NULL DEFAULT 'user'
  CONSTRAINT users_role_check CHECK (role IN ('user', 'editor', 'admin'));

ALTER TABLE recipes ADD COLUMN wiki_edited_at timestamptz;

ALTER TABLE ingredients
  ADD COLUMN wiki_edited_at timestamptz,
  ADD COLUMN wiki_version integer NOT NULL DEFAULT 0;

ALTER TABLE recipe_revisions ADD COLUMN meta jsonb;

-- 原料词条修订历史。snapshot 是修订后的完整词条快照（名称、别名、双语说明），
-- 首次修订时先补一条 version 0 记下种子原样，这样第一笔改动也能对比与回滚。
CREATE TABLE ingredient_revisions (
  ingredient_id text NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
  version       integer NOT NULL,
  snapshot      jsonb NOT NULL,
  editor_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ingredient_id, version)
);

-- 「最近更改」按时间倒序合并两张修订表
CREATE INDEX ingredient_revisions_recent_idx ON ingredient_revisions (created_at DESC);
CREATE INDEX recipe_revisions_recent_idx ON recipe_revisions (created_at DESC);

-- +goose Down

DROP INDEX IF EXISTS recipe_revisions_recent_idx;
DROP TABLE IF EXISTS ingredient_revisions;
ALTER TABLE recipe_revisions DROP COLUMN IF EXISTS meta;
ALTER TABLE ingredients DROP COLUMN IF EXISTS wiki_version, DROP COLUMN IF EXISTS wiki_edited_at;
ALTER TABLE recipes DROP COLUMN IF EXISTS wiki_edited_at;
ALTER TABLE users DROP COLUMN IF EXISTS role;
