# API 定义

REST + OpenAPI。实现用 huma v2（code-first，自动产出 `schema/openapi.yaml`），前端用 `openapi-typescript` 从 spec 生成 client（ADR-017）。

**Schema 流向是单向的：API 从 Go 流向 TS。** 不要手改 `schema/openapi.yaml`，改 Go handler 再跑 `go run ./cmd/gen-openapi`，CI 有 diff 检查。

---

## 1. 全局约定

### 1.1 基址与版本

```
/api/v1/...
```

版本号放路径。v1 内只做向后兼容的变更（加字段、加可选参数）；破坏性变更开 `/api/v2`。

### 1.2 认证

```
Authorization: Bearer <access_token>
```

- **access token**：JWT，15 分钟有效，不落库
- **refresh token**：随机不透明串，30 天有效，**只在库里存哈希**（`sessions.refresh_token_hash`），刷新时轮转（rotate on use）
- 密码哈希用 **argon2id**

轮转意味着：刷新一次旧 refresh token 立即失效。检测到已失效 token 被重用 → 撤销该用户全部会话（token 泄露的标准应对）。

### 1.3 分页：一律 cursor，不用 offset

```
GET /recipes?limit=20&cursor=eyJoIjoxMi4zLCJpZCI6IjAxOT...
```

```jsonc
{
  "items": [ /* ... */ ],
  "nextCursor": "eyJoIjo4LjEsImlkIjoiMDE5..."   // null 表示到底了
}
```

cursor 是 base64 编码的排序键元组（如 `{hot_score, id}` 或 `{published_at, id}`），**必须带 `id` 作为 tiebreaker**，否则同分数的行会重复或漏掉。

不用 offset 的理由：Feed 在翻页期间会有新内容插入，offset 会导致重复项和跳过项；且 `OFFSET 10000` 要扫 10000 行。

`limit` 默认 20，上限 50。

### 1.4 错误格式

```jsonc
{
  "error": {
    "code": "recipe.validation_failed",
    "message": "配方校验未通过",
    "details": [
      { "code": "topup.wrong_unit", "message": "TOP_UP 引用的原料 \"i4\" 单位必须是 top_up", "path": "steps[4]" }
    ]
  }
}
```

`details` 直接复用 `packages/recipe-ir` 的 `Diagnostic` 结构（规范 §10），所以编辑器能把错误定位到具体字段。

HTTP 状态：`400` 校验失败 / `401` 未认证 / `403` 无权限 / `404` 不存在 / `409` 冲突（slug 重复、已点赞）/ `422` 语义错误 / `429` 限流 / `5xx`。

### 1.5 幂等与并发

- 写配方用 `If-Match: <version>`（乐观锁，值取 `recipes.ir_version` 或 `updated_at`）；冲突返回 `409` + 当前版本，前端提示"已被另一处修改"
- 点赞/取消赞天然幂等（主键防重），重复调用返回 `200` 而非 `409`
- `POST /recipes` 支持 `Idempotency-Key` 头，避免网络重试建出两份草稿

---

## 2. 端点清单

### 2.1 认证

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/auth/register` | `{handle, email, password, displayName}` → 令牌对 |
| `POST` | `/auth/login` | `{identifier, password}`（handle 或 email） |
| `POST` | `/auth/refresh` | `{refreshToken}` → 新令牌对（旧的立即失效） |
| `POST` | `/auth/logout` | 撤销当前会话 |
| `POST` | `/auth/logout-all` | 撤销全部会话 |
| `GET` | `/me` | 当前用户，含 `unitPreference` |
| `PATCH` | `/me` | 改资料与偏好 |
| `POST` | `/me/password` | 改密码（需旧密码），成功后撤销其它会话 |

### 2.2 词表

```
GET /vocab
```

**一次性返回全部受控词表 + 版本号**，客户端强缓存：

```jsonc
{
  "version": "2026-09-14T03:21:00Z",   // 用于 If-None-Match / 缓存失效
  "ingredients": [ { "id": "gin-london-dry", "nameZh": "伦敦干金酒", "nameEn": "London Dry Gin",
                     "category": "spirit", "subcategory": "gin", "abv": 40, "density": 0.94,
                     "viz": { "color": "#f2f4f0", "viscosity": "low", "texture": "clear" },
                     "aliases": ["金酒", "琴酒", "gin"] } ],
  "glassware":  [ { "id": "coupe", "nameZh": "碟形杯", "nameEn": "Coupe",
                    "capacityMl": 180, "shape": { "profile": [ /* ... */ ] } } ],
  "techniques": [ { "id": "SHAKE", "nameZh": "摇和", "nameEn": "Shake", "iconId": "shaker" } ],
  "tags":       [ { "id": "refreshing", "nameZh": "清爽", "nameEn": "Refreshing", "kind": "taste" } ]
}
```

**为什么一次全拉而不分页**：编辑器需要全量词表做即时选择与校验，200 个原料 + 20 个杯型的 JSON 大约 100~200KB，gzip 后更小。分页只会让编辑器变慢变复杂。配 `ETag` + `Cache-Control: max-age=3600`。

单独查询仍然提供（原料百科页需要）：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/ingredients?category=&subcategory=&q=&cursor=` | 分类浏览 + 模糊搜索 |
| `GET` | `/ingredients/:id` | 原料详情（含 `description_zh_md`） |
| `GET` | `/ingredients/:id/recipes?sort=hot\|new` | **用到它的配方**（需求 1 的反查） |
| `GET` | `/glassware/:id` | 杯型详情 |

### 2.3 配方

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/recipes` | 建草稿。body 含 `ir` + 元数据 |
| `PATCH` | `/recipes/:id` | 改草稿或已发布配方（需 `If-Match`） |
| `POST` | `/recipes/:id/publish` | 草稿 → 已发布。**此时才跑完整校验** |
| `POST` | `/recipes/:id/unpublish` | 撤回为草稿 |
| `DELETE` | `/recipes/:id` | 软删除 |
| `GET` | `/recipes/:id` | 按 UUID 取 |
| `GET` | `/r/:slug` | 按 slug 取（公开页面用这个，SEO 友好） |
| `GET` | `/recipes/:id/revisions` | 版本历史 |
| `GET` | `/recipes/:id/revisions/:version` | 某个历史版本的 IR |

**`GET /recipes/:id?expand=viz` 是核心读接口**，返回前端直接能渲染动画的一切：

```jsonc
{
  "id": "0193...", "slug": "daiquiri", "title": "Daiquiri",
  "lang": "zh", "descriptionMd": "...",
  "author": { "handle": "kafsaki", "displayName": "…", "avatarUrl": "…" },
  "ir": { "schemaVersion": 1, "glass": "coupe", "method": "shaken", /* ... */ },
  "family": "sour",
  "source": "classic", "isCanonical": true, "classicKey": "daiquiri",
  "ibaCategory": "unforgettable",
  "derivedFrom": null, "derivedCount": 127,
  "abvEst": 19.2, "totalVolumeMl": 100,
  "tasteProfile": { "sweet": 2, "sour": 4, "bitter": 0, "strength": 3 },
  "difficulty": 2, "servings": 1,
  "coverUrl": "https://cdn/…/cover-3.png",
  "counts": { "like": 842, "comment": 31, "collect": 210, "view": 15203 },
  "viewerState": { "liked": true, "collectedInMenus": ["0193…"] },
  "publishedAt": "2026-03-02T…", "updatedAt": "2026-09-01T…",

  // expand=viz 时附带：IR 里引用到的原料/杯型的完整视觉数据。
  // 有了它，客户端无需另外请求 /vocab 就能编译动画 —— 首屏少一个往返。
  "viz": {
    "ingredients": { "rum-white": { "nameZh": "白朗姆", "viz": { "color": "#f5f0e6", … } } },
    "glassware":   { "coupe": { "capacityMl": 180, "shape": { … } } }
  }
}
```

`viewerState` 只在带认证时出现，避免为"我点赞了吗"单独发请求（否则每张 Feed 卡片都要一次额外查询）。

**可选的服务端预编译**：

```
GET /recipes/:id/timeline?speedScale=1
```

返回 `animator-core` 编译好的 Timeline。v1 **不实现**——客户端编译更好（零延迟、可实时预览、省服务端 CPU）。这个口子留给两种未来情况：低端设备降级，以及 Flutter 之类无法跑 TS 的客户端（ADR-005）。

### 2.4 互动

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `PUT` | `/recipes/:id/like` | 点赞（幂等） |
| `DELETE` | `/recipes/:id/like` | 取消 |
| `GET` | `/recipes/:id/likes?cursor=` | 点赞用户列表 |
| `GET` | `/recipes/:id/comments?cursor=` | 顶层评论 + 每条前 3 条回复 |
| `POST` | `/recipes/:id/comments` | `{body, parentId?}`。**只允许一层回复** |
| `GET` | `/comments/:id/replies?cursor=` | 展开某条的全部回复 |
| `PATCH` | `/comments/:id` | 编辑自己的评论 |
| `DELETE` | `/comments/:id` | 软删除 |
| `PUT`/`DELETE` | `/comments/:id/like` | 评论点赞 |

用 `PUT`/`DELETE` 而非 `POST`/`POST` 表达点赞：点赞是**幂等的状态设置**，不是事件追加。重复 `PUT` 返回 `200`，不是 `409`。

### 2.5 Feed

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/feed/hot?window=7d&cursor=` | 热门。`window`: `24h\|7d\|30d\|all` |
| `GET` | `/feed/new?cursor=` | 最新 |
| `GET` | `/feed/following?cursor=` | 关注的人（需认证） |

**Feed 层的 classic_key 折叠规则（ADR-013）** ——这是防止首页被 127 个 Daiquiri 淹死的地方：

```jsonc
{
  "items": [
    { "id": "…", "title": "Daiquiri", "classicKey": "daiquiri", "isCanonical": true,
      "collapsedVariants": { "count": 125, "url": "/api/v1/classics/daiquiri/variants" } },
    { "id": "…", "title": "Smoky Devil", "classicKey": null, "derivedFrom": "…" }
  ],
  "nextCursor": "…"
}
```

规则：**同一 `classic_key` 在单个分页窗口内最多 2 条**，其余折叠为 `collapsedVariants`。放在应用层而非数据库层，调参便宜。

### 2.6 经典条目

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/classics?ibaCategory=&family=&cursor=` | 经典配方列表 |
| `GET` | `/classics/:classicKey` | 权威条目（等价于该 key 下 `is_canonical` 的配方） |
| `GET` | `/classics/:classicKey/variants?sort=hot\|new&cursor=` | 社区变体 |
| `GET` | `/classics/:classicKey/distribution` | **规格分布**（见下） |

`/distribution` 是 IR 白拿的产品亮点（ADR-013），普通菜谱站做不到：

```jsonc
{
  "classicKey": "daiquiri",
  "variantCount": 127,
  "ingredients": [
    { "ingredientId": "rum-white", "role": "base", "presentIn": 121,
      "amountMl": { "p10": 45, "p25": 50, "median": 60, "p75": 60, "p90": 70 } },
    { "ingredientId": "lime-juice", "role": "souring", "presentIn": 127,
      "amountMl": { "p10": 15, "p25": 20, "median": 22.5, "p75": 25, "p90": 30 } }
  ],
  "abvEst": { "median": 19.4, "p10": 15.2, "p90": 24.1 }
}
```

一眼看出社区共识落点、自己的配方偏甜还是偏酸。数据全部来自 `recipe_ingredients` 投影表的聚合查询。

配方对比（同样白拿）：

```
GET /recipes/compare?ids=<uuid>,<uuid>
```

### 2.7 搜索

```
GET /search?q=&type=recipe|user|ingredient|menu|all
           &ingredient=gin-london-dry&ingredientRole=base
           &family=sour&method=shaken&glass=coupe
           &tag=refreshing&abvMin=10&abvMax=25&difficultyMax=3
           &sort=relevance|hot|new&cursor=
```

`type=all` 时返回分组结果（每组前 5 条 + 各自的"查看全部"链接）：

```jsonc
{
  "recipes":     { "items": [...], "total": 128, "more": "/api/v1/search?type=recipe&q=…" },
  "users":       { "items": [...], "total": 3,   "more": "…" },
  "ingredients": { "items": [...], "total": 7,   "more": "…" }
}
```

搜索 `Daiquiri` 时，**权威条目置顶**，社区变体作为分组出现（不平铺进主列表）。

`ingredient` 可重复传（`&ingredient=a&ingredient=b` = 同时含 a 和 b）。

### 2.8 用户与关注

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/users/:handle` | 公开资料 + 计数 |
| `GET` | `/users/:handle/recipes?cursor=` | 已发布配方 |
| `GET` | `/users/:handle/menus?cursor=` | 公开酒单 |
| `GET` | `/users/:handle/likes?cursor=` | 点赞过的配方（可设为私密） |
| `GET` | `/users/:handle/followers` `/following` | 关注关系 |
| `PUT`/`DELETE` | `/users/:handle/follow` | 关注/取关（幂等） |
| `GET` | `/me/drafts?cursor=` | 我的草稿 |

### 2.9 酒单

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/menus` | 建酒单 |
| `GET` | `/menus/:id` | 详情（按 `visibility` 鉴权） |
| `GET` | `/menus/shared/:shareToken` | 通过分享链接访问 `unlisted` 酒单 |
| `PATCH` | `/menus/:id` | 改标题/描述/可见性 |
| `DELETE` | `/menus/:id` | 软删除 |
| `PUT` | `/menus/:id/items/:recipeId` | **加入酒单（幂等）**，body 可带 `note` |
| `DELETE` | `/menus/:id/items/:recipeId` | 移出 |
| `POST` | `/menus/:id/items/reorder` | `{recipeId, afterRecipeId?}` → 服务端算 `position` 中点 |
| `POST` | `/menus/:id/share` | 生成/轮换 `shareToken` |
| `GET` | `/me/menus` | 我的全部酒单（含私密），**带 `containsRecipe` 标记** |

`GET /me/menus?containsRecipe=<uuid>` 是"方便地把配方加进某个酒单"（需求 5）的关键接口：一次请求拿到我的所有酒单 + 每个酒单是否已含这个配方，弹层里直接渲染带勾选状态的列表。

重排用 `afterRecipeId` 而非绝对 `position`——客户端不需要知道 `numeric` 的内部值，服务端算中点插入（DB 设计 §9.1）。

### 2.10 媒体上传

```
POST /media/upload-url
{ "purpose": "recipe_cover", "entityId": "<recipe uuid>", "mimeType": "image/png", "byteSize": 184320 }
→ { "assetId": "…", "uploadUrl": "https://minio/…?X-Amz-Signature=…", "storageKey": "recipes/…/cover-3.png", "expiresIn": 900 }

PUT <uploadUrl>            （客户端直传，不经过后端）

POST /media/:assetId/commit
→ { "url": "https://cdn/recipes/…/cover-3.png" }
```

三步流程是 ADR-015（前端 canvas 截帧上传封面）能安全工作的前提。未 commit 的记录由 river 周期任务连对象一起清理。

服务端在签发 URL 时校验 `mimeType` 白名单与 `byteSize` 上限，并把 key 规范写死（客户端不能自选路径）。

### 2.11 通知与举报

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/notifications?unreadOnly=&cursor=` | 收件箱 |
| `GET` | `/notifications/unread-count` | 未读数（轻量，给小红点用） |
| `POST` | `/notifications/read` | `{ids?}`，不传 ids 则全部标读 |
| `POST` | `/reports` | `{entityType, entityId, reason, detail?}` |

---

## 3. 发布流程与校验时机

这是 API 设计里最需要说清的一点：**草稿宽松，发布严格。**

```
POST  /recipes            → 只校验 JSON Schema（结构），业务规则的 error 降级为 warn
PATCH /recipes/:id        → 同上
POST  /recipes/:id/publish → 跑完整校验：JSON Schema + 全部业务规则（规范 §10）
                             error 存在则 400，附 details；warn 不阻止
```

理由：作者是**边想边填**的。刚建草稿时"酒还没进杯子"（`flow.nothing_in_glass`）是正常状态，不该报错。只有点"发布"时才要求配方完整自洽。

发布时服务端做的事（单个事务）：

1. 完整校验 `ir`（JSON Schema + 业务规则）
2. 从 `ir` 投影 `recipe_ingredients`（DELETE + INSERT）
3. 算 `abv_est`、`total_volume_ml`（含冰融水稀释，规范 §7.4）
4. 投影 `glass_id`、`method`
5. 生成/去重 `slug`（冲突加后缀，`is_canonical` 的条目保留干净 slug）
6. 写 `recipe_revisions`
7. 置 `status = 'published'`、`published_at`
8. 入队 river 任务：更新 `ingredients.recipe_count`、`hot_score`、给关注者发通知

**注意第 3 步的 ABV 必须在服务端算，不能信客户端**——它会被用来筛选，客户端可篡改。算法与 `packages/recipe-ir` 的 `estimateAbv` 必须一致，所以 Go 侧要么复刻这段逻辑并配对照测试，要么从 IR 里读客户端算好的值仅作显示、筛选另算。**选前者**：逻辑很短（约 20 行），配一组共享的黄金测试用例（同一份 IR，TS 与 Go 必须算出同一个数）。

---

## 4. 限流

| 端点组 | 限制 |
| --- | --- |
| `/auth/login` `/auth/register` | 每 IP 10 次/分钟，失败 5 次后指数退避 |
| 写操作（POST/PATCH/PUT/DELETE） | 每用户 60 次/分钟 |
| `POST /recipes/:id/publish` | 每用户 10 次/小时 |
| `POST /reports` | 每用户 20 次/天 |
| 读操作 | 每 IP 300 次/分钟 |

v1 用进程内令牌桶（单实例够）。多实例时改用 Postgres 或 Redis——**这是 v1 之后最可能第一个需要 Redis 的地方**（ADR-006）。

---

## 5. v2 预留（不实现，仅记录形态）

AI 接口用 SSE 而非普通 JSON，因为要流式返回 + 展示工具调用过程：

```
POST /ai/parse-recipe    (SSE)  {text} → {ir, unresolved[], warnings[], confidence}
POST /ai/agent/messages  (SSE)  流式文本 + 工具调用 + 配方卡片
```

`/ai/parse-recipe` 的响应结构要能表达**部分成功**——`unresolved` 列出对不上词表的原料字符串，前端把它们渲染成编辑器里待填的空位（ADR-008 的降级路径）。

---

## 6. 与前端的契约生成

```bash
# Go → spec
go run ./cmd/gen-openapi > schema/openapi.yaml
# spec → TS client
pnpm --filter @shaker/api-client generate
# CI 防漂移
go run ./cmd/gen-openapi | diff -u schema/openapi.yaml -
```
