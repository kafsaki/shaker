-- +goose Up

-- 配方短号（B 站 BV 号模式）：对外标识彻底取代 slug。
-- 序列起始 58^5 = 656356768 —— 起号编码恰为 6 位 base58（"211111"），
-- 此后恒 6 位（容量 58^6 - 58^5 ≈ 374 亿），不可复用（软删行保留号）。
-- slug 的中文标题水土不服且养了一套复杂逻辑（去重分配、草稿占位、
-- 软删改写、经典名预留），随本迁移一并拆除。

CREATE SEQUENCE recipes_short_no_seq START 656356768;

ALTER TABLE recipes ADD COLUMN short_no bigint;
UPDATE recipes SET short_no = nextval('recipes_short_no_seq');
ALTER TABLE recipes
  ALTER COLUMN short_no SET NOT NULL,
  ALTER COLUMN short_no SET DEFAULT nextval('recipes_short_no_seq');
CREATE UNIQUE INDEX recipes_short_no_key ON recipes (short_no);

DROP INDEX recipes_slug_key;
ALTER TABLE recipes DROP COLUMN slug;

-- seed 权威条目的 upsert 冲突键从 slug 转到这里：一个 classic_key 只允许
-- 一个权威条目（顺带在 DB 层强制了这个不变量）。部分环境已手工建过同名
-- 索引 → IF NOT EXISTS。
CREATE UNIQUE INDEX IF NOT EXISTS recipes_canonical_key ON recipes (classic_key) WHERE is_canonical;

-- +goose Down

-- 原始 slug 已不可恢复，用短号占位；回滚后需人工重发布生成正式 slug。
ALTER TABLE recipes ADD COLUMN slug text NOT NULL DEFAULT 'migrated-' || short_no::text;
CREATE UNIQUE INDEX recipes_slug_key ON recipes (slug);

DROP INDEX IF EXISTS recipes_canonical_key;
DROP INDEX recipes_short_no_key;
ALTER TABLE recipes DROP COLUMN short_no;
DROP SEQUENCE recipes_short_no_seq;
