-- +goose Up

-- 热门排序键改为「互动总量」：hot = like_count + collect_count + comment_count。
-- 原先的时间衰减加权公式（DB 设计 §5）暂时下线，先按纯计数排序看社区共识落点。
--
-- 存量行的 hot_score 是按旧公式算出来的（且绝大多数为 0，热门流实际退化成
-- 按 id 排序），必须整表回填一次，否则改完公式热门流仍然按陈旧值排序。
-- 回填条件与 recipe.TouchHot 保持一致（只算已发布的行）。

UPDATE recipes
SET hot_score = like_count + collect_count + comment_count
WHERE published_at IS NOT NULL;

COMMENT ON COLUMN recipes.hot_score IS
  '热门排序键 = like_count + collect_count + comment_count（互动/发布时由 recipe.TouchHot 内联重算）';

-- +goose Down

-- 回到时间衰减加权公式（数值随时点重算，无法还原迁移前的历史值）。
UPDATE recipes
SET hot_score = (
  like_count + 2 * collect_count + 0.5 * comment_count + 1
) / power(extract(epoch FROM (now() - published_at)) / 3600 + 2, 1.6)
WHERE published_at IS NOT NULL;

COMMENT ON COLUMN recipes.hot_score IS '时间衰减热度，由 river worker 周期重算（ADR-006）';