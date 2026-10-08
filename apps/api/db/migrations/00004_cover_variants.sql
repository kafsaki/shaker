-- +goose Up

-- 配方封面双版本（暗/亮）：前端按主题各截一帧，两份都存。
-- cover_url 保持「暗色」语义（存量数据零迁移、feed/search/menus 投影零破坏）；
-- 新增 cover_url_light 存亮色版，缺失时前端回落 cover_url。
ALTER TABLE recipes ADD COLUMN cover_url_light text;

-- 配方封面对象键改为固定名 recipes/{id}/cover-dark.png | cover-light.png
-- （覆盖写，不再因每次重截产生孤儿对象）。media_assets 从「上传流水」转为
-- 「当前现状」：记录 variant 以区分同实体的两份封面；同 key 再签发走 UPSERT 覆盖。
ALTER TABLE media_assets ADD COLUMN variant text;

-- +goose Down

ALTER TABLE media_assets DROP COLUMN variant;
ALTER TABLE recipes DROP COLUMN cover_url_light;