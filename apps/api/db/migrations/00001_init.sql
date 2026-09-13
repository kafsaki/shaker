-- +goose Up

-- ════════════════════════════ 扩展 ════════════════════════════
-- pg_trgm 是搜索主力（ADR-012）：contrib 自带、中英通吃、支持拼写容错与部分匹配。
-- 需求 4 的四种搜索（配方名、酒名、用户名、原料名）全是短词场景。
-- pgvector 在 v1 不建列：加可空列在 PG11+ 是瞬时操作，没必要现在给开发环境增加依赖。
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS btree_gin;

-- ════════════════════════════ 枚举 ════════════════════════════
-- 只为「纯数据库概念」建原生枚举。
-- family / category / role / unit 这些已经在 packages/recipe-ir 的 zod 里定义了，
-- 再建一份 PG 枚举就有了第三个真相源（ADR-017）—— 那些字段用 text，由应用层按 JSON Schema 校验。
CREATE TYPE recipe_status   AS ENUM ('draft', 'published', 'hidden', 'removed');
CREATE TYPE recipe_source   AS ENUM ('original', 'classic', 'imported');
CREATE TYPE menu_visibility AS ENUM ('public', 'unlisted', 'private');
CREATE TYPE report_status   AS ENUM ('open', 'reviewing', 'resolved', 'dismissed');
CREATE TYPE user_status     AS ENUM ('active', 'suspended', 'deleted');

-- ════════════════════════════ 通用触发器 ════════════════════════════
-- +goose StatementBegin
CREATE FUNCTION touch_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

-- ════════════════════════════ 用户 ════════════════════════════
-- id 用 UUIDv7（在 Go 侧生成）：时间有序保证索引局部性，且可安全暴露在 URL 里。
-- PG 17 没有内置 uuidv7()，不为此引入扩展。
CREATE TABLE users (
  id              uuid PRIMARY KEY,
  handle          text NOT NULL,
  display_name    text NOT NULL,
  email           text NOT NULL,
  email_verified  boolean NOT NULL DEFAULT false,
  password_hash   text,                          -- 纯 OAuth 用户为 NULL
  avatar_url      text,
  bio             text,
  location        text,
  website         text,
  -- 展示偏好（ADR-014）：ml/oz 切换纯前端计算，这里只存用户选择
  unit_preference text NOT NULL DEFAULT 'ml',
  status          user_status NOT NULL DEFAULT 'active',
  is_official     boolean NOT NULL DEFAULT false, -- 经典配方的挂靠账号
  follower_count  integer NOT NULL DEFAULT 0,
  following_count integer NOT NULL DEFAULT 0,
  recipe_count    integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz,
  CONSTRAINT users_handle_format CHECK (handle ~ '^[a-zA-Z0-9_]{3,24}$'),
  CONSTRAINT users_unit_pref     CHECK (unit_preference IN ('ml', 'oz'))
);
-- handle 与 email 大小写不敏感唯一
CREATE UNIQUE INDEX users_handle_lower_key ON users (lower(handle));
CREATE UNIQUE INDEX users_email_lower_key  ON users (lower(email));
-- 用户名搜索（需求 4）
CREATE INDEX users_handle_trgm  ON users USING gin (handle gin_trgm_ops);
CREATE INDEX users_display_trgm ON users USING gin (display_name gin_trgm_ops);
CREATE TRIGGER users_touch BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE sessions (
  id               uuid PRIMARY KEY,
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_token_hash text NOT NULL,     -- 只存哈希，原值仅返回给客户端一次
  user_agent       text,
  ip               inet,
  expires_at       timestamptz NOT NULL,
  revoked_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX sessions_token_key ON sessions (refresh_token_hash);
CREATE INDEX sessions_user_idx ON sessions (user_id) WHERE revoked_at IS NULL;

CREATE TABLE follows (
  follower_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  followee_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_id, followee_id),
  CONSTRAINT follows_no_self CHECK (follower_id <> followee_id)
);
-- 反查粉丝列表
CREATE INDEX follows_followee_idx ON follows (followee_id, created_at DESC);

-- ════════════════════════════ 词表 ════════════════════════════
-- 受控词表强制双语（ADR-011）。UGC 是单语 + lang 字段，见 recipes。

-- 品类 14 类不压缩（ADR-009）：分类有物理依据（密度、含气、粘度、计量单位）。
-- category/subcategory 用 text 不用 PG 枚举 —— 值域由 zod vocab 定义，见上文注释。
CREATE TABLE ingredients (
  id              text PRIMARY KEY,              -- slug，如 'gin-london-dry'
  name_zh         text NOT NULL,
  name_en         text NOT NULL,
  category        text NOT NULL,
  subcategory     text,
  abv             numeric(4,1),                  -- 无酒精为 0，未知为 NULL
  density         numeric(4,3),                  -- g/cm³，驱动分层排序
  description_zh_md text,
  description_en_md text,                        -- 可空，英文描述后补
  -- 视觉样式挂在原料表上，配方只引 ID（ADR-002）—— 改一次全站生效。
  -- 结构见 docs/01-配方IR规范.md §7.1
  viz             jsonb NOT NULL,
  is_official     boolean NOT NULL DEFAULT true, -- false = 用户提交待审
  created_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  recipe_count    integer NOT NULL DEFAULT 0,    -- 「用到它的配方」计数
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ingredients_id_slug CHECK (id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  CONSTRAINT ingredients_abv_range CHECK (abv IS NULL OR (abv >= 0 AND abv <= 100))
);
CREATE INDEX ingredients_category_idx ON ingredients (category, subcategory);
-- 原料名搜索（需求 4）
CREATE INDEX ingredients_name_zh_trgm ON ingredients USING gin (name_zh gin_trgm_ops);
CREATE INDEX ingredients_name_en_trgm ON ingredients USING gin (name_en gin_trgm_ops);
CREATE TRIGGER ingredients_touch BEFORE UPDATE ON ingredients
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- 别名用独立表而非 text[]：pg_trgm 索引不能直接作用在数组上，
-- 而「按原料名搜索」正是需求 4 的一项。这张表同时是 v2 让模型对齐原料 ID 的依据。
CREATE TABLE ingredient_aliases (
  ingredient_id text NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
  alias         text NOT NULL,
  lang          text NOT NULL,                  -- 'zh' | 'en'
  PRIMARY KEY (ingredient_id, alias)
);
CREATE INDEX ingredient_aliases_trgm ON ingredient_aliases USING gin (alias gin_trgm_ops);

CREATE TABLE glassware (
  id          text PRIMARY KEY,
  name_zh     text NOT NULL,
  name_en     text NOT NULL,
  capacity_ml integer NOT NULL,
  -- 剖面模型，驱动体积↔液面高度积分（规范 §6）
  shape       jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT glassware_capacity_positive CHECK (capacity_ml > 0)
);
CREATE TRIGGER glassware_touch BEFORE UPDATE ON glassware
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- 与 zod 的 ACTIONS 词表一一对应，存文案与图标供编辑器展示。
-- 动作的**行为**定义在代码里，这张表只管展示。
CREATE TABLE techniques (
  id                text PRIMARY KEY,           -- 'SHAKE'、'STRAIN'…
  name_zh           text NOT NULL,
  name_en           text NOT NULL,
  icon_id           text,
  description_zh_md text,
  description_en_md text,
  sort_order        smallint NOT NULL DEFAULT 0
);

CREATE TABLE tags (
  id         text PRIMARY KEY,
  name_zh    text NOT NULL,
  name_en    text NOT NULL,
  kind       text NOT NULL,                     -- 'taste' | 'occasion' | 'season' | 'other'
  recipe_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tags_kind_idx ON tags (kind);

-- ════════════════════════════ 配方 ════════════════════════════
CREATE TABLE recipes (
  id              uuid PRIMARY KEY,
  author_id       uuid REFERENCES users(id) ON DELETE SET NULL,
  slug            text NOT NULL,
  title           text NOT NULL,
  subtitle        text,
  description_md  text,
  -- UGC 单语 + 语种标记（ADR-011）。要求用户双语发布会直接掐死发布量。
  lang            text NOT NULL DEFAULT 'zh',

  -- ir 存 JSONB 而非拆成 steps 表：配方是原子读写单元，永远整份取出。
  -- 拆表只会带来 N+1 和事务复杂度。需要查询的维度用 recipe_ingredients 投影。
  ir              jsonb NOT NULL,
  ir_version      integer NOT NULL DEFAULT 1,

  -- 以下三项从 ir 投影而来，仅为筛选加速。ir 是真相源。
  glass_id        text NOT NULL REFERENCES glassware(id),
  method          text NOT NULL,
  -- family 可空、单选、运营可改（ADR-010）：业内对家族边界本身有争议
  family          text,

  -- 变体双机制（ADR-013）
  source          recipe_source NOT NULL DEFAULT 'original',
  is_canonical    boolean NOT NULL DEFAULT false,
  classic_key     text,                          -- 经典锚点，处理「同名经典的不同规格」
  derived_from    uuid REFERENCES recipes(id) ON DELETE SET NULL, -- 创作血缘
  derived_count   integer NOT NULL DEFAULT 0,    -- 「被 N 人改编」
  iba_category    text,                          -- 权威徽章，不做导航维度

  -- 封面图由前端 canvas 截帧、预签名直传（ADR-015）—— 服务端零渲染负担
  cover_url       text,
  status          recipe_status NOT NULL DEFAULT 'draft',

  abv_est         numeric(4,1),                  -- 含冰融水稀释，见规范 §7.4
  total_volume_ml numeric(6,1),
  taste_profile   jsonb,                         -- {sweet,sour,bitter,strength} 各 0..5
  difficulty      smallint,

  like_count      integer NOT NULL DEFAULT 0,
  comment_count   integer NOT NULL DEFAULT 0,
  collect_count   integer NOT NULL DEFAULT 0,
  view_count      integer NOT NULL DEFAULT 0,
  -- 时间衰减热度，由 river worker 周期重算（ADR-006）
  hot_score       real NOT NULL DEFAULT 0,

  -- 英文长文用 tsvector；中文与短词场景走 pg_trgm（ADR-012）
  search_en       tsvector,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  published_at    timestamptz,
  deleted_at      timestamptz,

  CONSTRAINT recipes_lang        CHECK (lang IN ('zh', 'en')),
  CONSTRAINT recipes_difficulty  CHECK (difficulty IS NULL OR difficulty BETWEEN 1 AND 5),
  CONSTRAINT recipes_iba         CHECK (iba_category IS NULL
                                   OR iba_category IN ('unforgettable','contemporary','new_era')),
  CONSTRAINT recipes_no_self_derive CHECK (derived_from IS NULL OR derived_from <> id),
  -- 权威条目必须声明它是哪个经典
  CONSTRAINT recipes_canonical_needs_key CHECK (NOT is_canonical OR classic_key IS NOT NULL),
  -- 已发布必须有发布时间
  CONSTRAINT recipes_published_at CHECK (status <> 'published' OR published_at IS NOT NULL)
);

CREATE UNIQUE INDEX recipes_slug_key ON recipes (slug);
-- 一个经典只能有一个权威条目（ADR-013）
CREATE UNIQUE INDEX recipes_canonical_key ON recipes (classic_key) WHERE is_canonical;
-- 经典页聚合变体 + Feed 层按 classic_key 折叠
CREATE INDEX recipes_classic_idx ON recipes (classic_key, hot_score DESC)
  WHERE classic_key IS NOT NULL AND status = 'published';
CREATE INDEX recipes_derived_idx ON recipes (derived_from) WHERE derived_from IS NOT NULL;
-- 热门 Feed：偏索引让扫描只覆盖已发布行
CREATE INDEX recipes_hot_idx ON recipes (hot_score DESC, id)
  WHERE status = 'published' AND deleted_at IS NULL;
-- 最新 Feed
CREATE INDEX recipes_new_idx ON recipes (published_at DESC, id)
  WHERE status = 'published' AND deleted_at IS NULL;
-- 关注 Feed + 用户主页
CREATE INDEX recipes_author_idx ON recipes (author_id, published_at DESC)
  WHERE status = 'published' AND deleted_at IS NULL;
-- 多维筛选（基酒走 recipe_ingredients，这里是杯型/手法/家族/酒精度）
CREATE INDEX recipes_filter_idx ON recipes (family, method, glass_id)
  WHERE status = 'published' AND deleted_at IS NULL;
CREATE INDEX recipes_abv_idx ON recipes (abv_est)
  WHERE status = 'published' AND deleted_at IS NULL;
-- 配方名搜索（需求 4）
CREATE INDEX recipes_title_trgm ON recipes USING gin (title gin_trgm_ops);
CREATE INDEX recipes_search_en_idx ON recipes USING gin (search_en);
CREATE TRIGGER recipes_touch BEFORE UPDATE ON recipes
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- 从第一天就有（ADR-013）：UGC + 未来的 AI 生成，一定会需要回滚和审计。
-- 惰性迁移策略要求原始版本永不覆盖（规范 §11）。
CREATE TABLE recipe_revisions (
  recipe_id  uuid NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  version    integer NOT NULL,
  ir         jsonb NOT NULL,
  ir_version integer NOT NULL,
  title      text NOT NULL,
  editor_id  uuid REFERENCES users(id) ON DELETE SET NULL,
  note       text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (recipe_id, version)
);

-- ir.ingredients 的投影表。保存配方时由应用层重建（DELETE + INSERT）。
-- 存在理由：JSONB 里按原料反查需要 GIN + 容器操作符，写起来别扭且不好做数值范围筛选；
-- 而「按原料名搜索」「含 40ml 以上金酒的配方」都是需求 4 的真实查询。
CREATE TABLE recipe_ingredients (
  recipe_id     uuid NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  slot          text NOT NULL,                  -- 同一配方可有两种朗姆，所以 PK 带 slot
  ingredient_id text NOT NULL REFERENCES ingredients(id) ON DELETE RESTRICT,
  amount        numeric(8,2),
  unit          text NOT NULL,
  amount_ml     numeric(8,2),                   -- 派生值，不可换算单位为 NULL
  role          text NOT NULL,
  position      smallint NOT NULL DEFAULT 0,
  PRIMARY KEY (recipe_id, slot)
);
-- 反查「用到某原料的配方」+ 用量范围筛选
CREATE INDEX recipe_ingredients_lookup_idx ON recipe_ingredients (ingredient_id, amount_ml);
-- 按角色筛选（「以金酒为基酒的配方」而非「任何位置含金酒」）
CREATE INDEX recipe_ingredients_role_idx ON recipe_ingredients (ingredient_id, role);

CREATE TABLE recipe_tags (
  recipe_id uuid NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  tag_id    text NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (recipe_id, tag_id)
);
CREATE INDEX recipe_tags_tag_idx ON recipe_tags (tag_id);

-- ════════════════════════════ 互动 ════════════════════════════
-- 计数冗余在 recipes 上，由同一事务内的原子 UPDATE 维护，
-- 另有 river 周期任务从这些表重算对账（ADR-006）。
CREATE TABLE likes (
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipe_id  uuid NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, recipe_id)   -- 主键即防重复点赞
);
CREATE INDEX likes_recipe_idx ON likes (recipe_id, created_at DESC);

-- 只做一层回复：parent_id 非空的评论，其父评论必须是顶层。
-- 这条约束在应用层保证（递归 CHECK 表达不了），深层嵌套是 UX 负担且需要更多基础设施。
CREATE TABLE comments (
  id         uuid PRIMARY KEY,
  recipe_id  uuid NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_id  uuid REFERENCES comments(id) ON DELETE CASCADE,
  body       text NOT NULL,
  like_count integer NOT NULL DEFAULT 0,
  reply_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT comments_body_len CHECK (char_length(body) BETWEEN 1 AND 4000)
);
CREATE INDEX comments_recipe_idx ON comments (recipe_id, created_at DESC)
  WHERE parent_id IS NULL AND deleted_at IS NULL;
CREATE INDEX comments_parent_idx ON comments (parent_id, created_at)
  WHERE parent_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX comments_user_idx ON comments (user_id, created_at DESC);
CREATE TRIGGER comments_touch BEFORE UPDATE ON comments
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE comment_likes (
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  comment_id uuid NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, comment_id)
);

-- ════════════════════════════ 酒单 ════════════════════════════
CREATE TABLE menus (
  id          uuid PRIMARY KEY,
  owner_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       text NOT NULL,
  description text,
  cover_url   text,
  visibility  menu_visibility NOT NULL DEFAULT 'private',
  share_token text,                              -- unlisted 用，随机不可猜
  item_count  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz,
  CONSTRAINT menus_title_len CHECK (char_length(title) BETWEEN 1 AND 120)
);
CREATE UNIQUE INDEX menus_share_token_key ON menus (share_token) WHERE share_token IS NOT NULL;
CREATE INDEX menus_owner_idx ON menus (owner_id, updated_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX menus_public_idx ON menus (updated_at DESC)
  WHERE visibility = 'public' AND deleted_at IS NULL;
CREATE TRIGGER menus_touch BEFORE UPDATE ON menus
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- position 用 numeric 而非 integer：拖拽重排时可以在两项之间插值（取中点），
-- 不必重写整个列表的序号。
CREATE TABLE menu_items (
  menu_id   uuid NOT NULL REFERENCES menus(id) ON DELETE CASCADE,
  recipe_id uuid NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  position  numeric(20,10) NOT NULL,
  note      text,
  added_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (menu_id, recipe_id)               -- 同一配方在一个酒单里只能出现一次
);
CREATE INDEX menu_items_order_idx ON menu_items (menu_id, position);
CREATE INDEX menu_items_recipe_idx ON menu_items (recipe_id);

-- ════════════════════════════ 平台 ════════════════════════════
CREATE TABLE notifications (
  id          uuid PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        text NOT NULL,                     -- like|comment|reply|follow|mention|system
  actor_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  entity_type text,                              -- recipe|comment|menu|user
  entity_id   uuid,
  payload     jsonb,
  read_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_inbox_idx ON notifications (user_id, created_at DESC);
CREATE INDEX notifications_unread_idx ON notifications (user_id) WHERE read_at IS NULL;

-- v1 不做内容安全审核与备案（ADR-007），但这两张表从第一天就留着 ——
-- 补审核逻辑比补数据模型容易。
CREATE TABLE reports (
  id           uuid PRIMARY KEY,
  reporter_id  uuid REFERENCES users(id) ON DELETE SET NULL,
  entity_type  text NOT NULL,                    -- recipe|comment|user|menu
  entity_id    uuid NOT NULL,
  reason       text NOT NULL,
  detail       text,
  status       report_status NOT NULL DEFAULT 'open',
  resolved_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  resolved_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX reports_queue_idx ON reports (status, created_at);
CREATE INDEX reports_entity_idx ON reports (entity_type, entity_id);

CREATE TABLE moderation_logs (
  id          uuid PRIMARY KEY,
  moderator_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action      text NOT NULL,                     -- hide|remove|restore|suspend|warn
  entity_type text NOT NULL,
  entity_id   uuid NOT NULL,
  reason      text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX moderation_logs_entity_idx ON moderation_logs (entity_type, entity_id, created_at DESC);

-- 对象存储 key 规范（ADR-018 列为半不可逆项，所以写死在这里）：
--   recipes/{recipe_id}/cover-{revision}.png
--   users/{user_id}/avatar-{content_hash}.jpg
--   menus/{menu_id}/cover-{content_hash}.jpg
-- key 里带 revision 或内容哈希，CDN 缓存靠换 URL 失效，不依赖 purge。
CREATE TABLE media_assets (
  id            uuid PRIMARY KEY,
  storage_key   text NOT NULL,
  owner_id      uuid REFERENCES users(id) ON DELETE SET NULL,
  entity_type   text,
  entity_id     uuid,
  mime_type     text NOT NULL,
  byte_size     bigint NOT NULL,
  width         integer,
  height        integer,
  content_hash  text,
  -- 预签名直传是两步：先建记录（pending），客户端传完再确认（committed）。
  -- 没确认的记录由 river 周期任务清理，避免孤儿对象。
  committed_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX media_assets_key_idx ON media_assets (storage_key);
CREATE INDEX media_assets_entity_idx ON media_assets (entity_type, entity_id);
CREATE INDEX media_assets_orphan_idx ON media_assets (created_at) WHERE committed_at IS NULL;

-- +goose Down
DROP TABLE IF EXISTS media_assets;
DROP TABLE IF EXISTS moderation_logs;
DROP TABLE IF EXISTS reports;
DROP TABLE IF EXISTS notifications;
DROP TABLE IF EXISTS menu_items;
DROP TABLE IF EXISTS menus;
DROP TABLE IF EXISTS comment_likes;
DROP TABLE IF EXISTS comments;
DROP TABLE IF EXISTS likes;
DROP TABLE IF EXISTS recipe_tags;
DROP TABLE IF EXISTS recipe_ingredients;
DROP TABLE IF EXISTS recipe_revisions;
DROP TABLE IF EXISTS recipes;
DROP TABLE IF EXISTS tags;
DROP TABLE IF EXISTS techniques;
DROP TABLE IF EXISTS glassware;
DROP TABLE IF EXISTS ingredient_aliases;
DROP TABLE IF EXISTS ingredients;
DROP TABLE IF EXISTS follows;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS users;
DROP FUNCTION IF EXISTS touch_updated_at();
DROP TYPE IF EXISTS user_status;
DROP TYPE IF EXISTS report_status;
DROP TYPE IF EXISTS menu_visibility;
DROP TYPE IF EXISTS recipe_source;
DROP TYPE IF EXISTS recipe_status;
