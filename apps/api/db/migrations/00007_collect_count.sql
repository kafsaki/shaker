-- +goose Up

-- collect_count 的日常维护放在应用层（菜单条目变更的同一事务里原子 UPDATE，
-- 见 DB 设计 §3.3），本次迁移只做两件一次性的事：
--   1. 存量回填——在此之前没有任何代码写过 collect_count，全库都是 0；
--   2. 同步热门排序键——hot_score = like_count + collect_count + comment_count，
--      收藏数变了它必须跟着变，否则热门流用的还是旧的收藏分量。

UPDATE recipes r
SET collect_count = (
  SELECT count(*) FROM menu_items mi
  JOIN menus m ON m.id = mi.menu_id
  WHERE mi.recipe_id = r.id AND m.deleted_at IS NULL
);

UPDATE recipes r
SET hot_score = r.like_count + r.collect_count + r.comment_count
WHERE r.published_at IS NOT NULL;

-- +goose Down

UPDATE recipes
SET collect_count = 0,
    hot_score = like_count + comment_count
WHERE published_at IS NOT NULL;