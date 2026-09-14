# 配方核心端到端验证（对运行中的本地 API）：CRUD + 发布事务 + 投影 + slug + revisions + expand=viz。
# 每次运行注册随机新用户，可反复执行。
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Net.Http
$base = 'http://localhost:8080/api/v1'
$fail = 0

function Check($name, $cond, $extra = '') {
    if ($cond) { Write-Host "PASS  $name" }
    else { Write-Host "FAIL  $name  $extra"; $script:fail = 1 }
}

$client = New-Object System.Net.Http.HttpClient
function Call($method, $path, $body = $null, $token = $null, $extraHeaders = @{}) {
    $req = New-Object System.Net.Http.HttpRequestMessage(
        (New-Object System.Net.Http.HttpMethod($method)), "$script:base$path")
    if ($null -ne $body) {
        $req.Content = New-Object System.Net.Http.StringContent($body, [Text.Encoding]::UTF8, 'application/json')
    }
    if ($token) { $req.Headers.Add('Authorization', "Bearer $token") }
    foreach ($k in $extraHeaders.Keys) { $req.Headers.Add($k, $extraHeaders[$k]) }
    $resp = $client.SendAsync($req).GetAwaiter().GetResult()
    $text = $resp.Content.ReadAsStringAsync().GetAwaiter().GetResult()
    if ($text) {
        return @{ status = [int]$resp.StatusCode; json = ($text | ConvertFrom-Json) }
    }
    return @{ status = [int]$resp.StatusCode; json = $null }
}

# ── IR 样本（与种子配方同构）──
# businessBad：结构合法但流程不完整（没滤进杯子、装饰物没用上）→ 草稿可存，发布被拒
$businessBadIR = @'
{
  "schemaVersion": 1, "glass": "coupe", "method": "shaken", "servings": 1,
  "ingredients": [
    {"slot":"g1","ingredientId":"gin-london-dry","role":"base","unit":"ml","amount":50},
    {"slot":"g2","ingredientId":"lime-juice","role":"souring","unit":"ml","amount":25},
    {"slot":"g3","ingredientId":"simple-syrup","role":"sweetener","unit":"ml","amount":15},
    {"slot":"g4","ingredientId":"lime-wheel","role":"garnish","unit":"piece","amount":1}
  ],
  "steps": [
    {"action":"ADD","id":"s1","target":"shaker","items":["g1","g2","g3"]},
    {"action":"ICE","id":"s2","target":"shaker","iceType":"cube","fill":0.8},
    {"action":"SHAKE","id":"s3","target":"shaker","durationSec":12,"intensity":"standard"}
  ]
}
'@

# good：完整自洽
$goodIR = @'
{
  "schemaVersion": 1, "glass": "coupe", "method": "shaken", "servings": 1,
  "ingredients": [
    {"slot":"g1","ingredientId":"gin-london-dry","role":"base","unit":"ml","amount":50},
    {"slot":"g2","ingredientId":"lime-juice","role":"souring","unit":"ml","amount":25},
    {"slot":"g3","ingredientId":"simple-syrup","role":"sweetener","unit":"ml","amount":15},
    {"slot":"g4","ingredientId":"lime-wheel","role":"garnish","unit":"piece","amount":1}
  ],
  "steps": [
    {"action":"ADD","id":"s1","target":"shaker","items":["g1","g2","g3"]},
    {"action":"ICE","id":"s2","target":"shaker","iceType":"cube","fill":0.8},
    {"action":"SHAKE","id":"s3","target":"shaker","durationSec":12,"intensity":"standard"},
    {"action":"STRAIN","id":"s4","from":"shaker","to":"glass","strainer":"hawthorne","double":true},
    {"action":"GARNISH","id":"s5","target":"glass","items":["g4"],"position":"rim","prep":"wheel"}
  ]
}
'@

# ── 0. 准备：注册用户、取基线计数 ──
$suffix = Get-Random -Maximum 1000000
$reg = Call POST '/auth/register' (@{
    handle = "e2e_r$suffix"; email = "e2e_r$suffix@test.local"
    password = 'passw0rd-long'; displayName = 'E2E 配方测试'
} | ConvertTo-Json)
Check '注册用户' ($reg.status -eq 200 -and $reg.json.accessToken)
$tok = $reg.json.accessToken

$me = Call GET '/me' $null $tok
Check '初始 recipeCount=0' ($me.json.recipeCount -eq 0)

$ginBefore = (Call GET '/ingredients/gin-london-dry').json.recipeCount
$daiq = Call GET '/r/daiquiri'
Check '种子配方可按 slug 取' ($daiq.status -eq 200 -and $daiq.json.isCanonical -and $daiq.json.classicKey -eq 'daiquiri')
$daiqDerivedBefore = $daiq.json.derivedCount

# ── 1. 创建校验（结构/引用）──
$badSchema = '{"title":"x","ir":{"schemaVersion":1,"glass":"coupe","method":"shaken","ingredients":[{"slot":"a","ingredientId":"gin-london-dry","role":"base","unit":"ml"}],"steps":[]}}'
$r = Call POST '/recipes' $badSchema $tok
Check 'schema 错误 → 400' ($r.status -eq 400 -and $r.json.error.code -eq 'recipe.ir_invalid')

$unknownGlass = (@{ title = 'x'; ir = ($goodIR | ConvertFrom-Json) } | ConvertTo-Json -Depth 10) -replace '"coupe"', '"unicorn-cup"'
$r = Call POST '/recipes' $unknownGlass $tok
Check '未知杯型 → 400' ($r.status -eq 400 -and $r.json.error.code -eq 'vocab.unknown_glass')

$r = Call POST '/recipes' (@{ title = 'x'; tags = @('no-such-tag'); ir = ($goodIR | ConvertFrom-Json) } | ConvertTo-Json -Depth 10) $tok
Check '未知标签 → 400' ($r.status -eq 400 -and $r.json.error.code -eq 'tag.not_found')

$r = Call POST '/recipes' (@{ title = 'x'; classicKey = 'no-such-classic'; ir = ($goodIR | ConvertFrom-Json) } | ConvertTo-Json -Depth 10) $tok
Check '未知经典锚点 → 400' ($r.status -eq 400 -and $r.json.error.code -eq 'recipe.classic_key_not_found')

# ── 2. 建草稿（业务错误降级为 warnings）──
$draftBody = @{
    title = 'E2E Gin Sour'; lang = 'zh'; family = 'sour'
    tags = @('refreshing'); difficulty = 2
    tasteProfile = @{ sweet = 1; sour = 3; bitter = 0; strength = 2 }
    ir = ($businessBadIR | ConvertFrom-Json)
} | ConvertTo-Json -Depth 10
$r = Call POST '/recipes' $draftBody $tok
Check '草稿创建 → 201' ($r.status -eq 201)
Check '草稿状态' ($r.json.recipe.status -eq 'draft')
Check '草稿占位 slug' ($r.json.recipe.slug -like 'draft-*')
Check '业务错误降级为 warnings' (@($r.json.warnings | Where-Object { $_.code -eq 'flow.nothing_in_glass' }).Count -eq 1)
Check 'irVersion=1' ($r.json.recipe.irVersion -eq 1)
Check '口味档案落库' ($r.json.recipe.tasteProfile.sour -eq 3)
$id = $r.json.recipe.id

# ── 3. 可见性：草稿仅作者 ──
$r = Call GET "/recipes/$id"
Check '匿名读草稿 → 404' ($r.status -eq 404)
$r = Call GET "/recipes/$id" $null $tok
Check '作者读草稿 → 200' ($r.status -eq 200 -and $r.json.status -eq 'draft')

# ── 4. 乐观锁 ──
$r = Call PATCH "/recipes/$id" (@{ title = 'x' } | ConvertTo-Json) $tok
Check '缺 If-Match → 400' ($r.status -eq 400 -and $r.json.error.code -eq 'recipe.if_match_invalid')

$r = Call PATCH "/recipes/$id" (@{ title = 'x' } | ConvertTo-Json) $tok @{ 'If-Match' = '"99"' }
Check 'If-Match 过期 → 409' ($r.status -eq 409 -and $r.json.error.code -eq 'recipe.version_conflict')
Check '409 带当前版本' (@($r.json.error.details | Where-Object { $_.code -eq 'current_version' }).Message -eq '1')

# ── 5. PATCH 修复 IR + 血缘 ──
$fixBody = @{
    ir = ($goodIR | ConvertFrom-Json); derivedFrom = $daiq.json.id
} | ConvertTo-Json -Depth 10
$r = Call PATCH "/recipes/$id" $fixBody $tok @{ 'If-Match' = '"1"' }
Check 'PATCH 成功' ($r.status -eq 200)
Check 'irVersion 递增到 2' ($r.json.recipe.irVersion -eq 2)
Check 'warnings 清空' (@($r.json.warnings).Count -eq 0)
Check '血缘写入' ($r.json.recipe.derivedFrom -eq $daiq.json.id)

# ── 6. 版本历史 ──
$r = Call GET "/recipes/$id/revisions" $null $tok
Check '版本历史 2 条' ($r.status -eq 200 -and $r.json.items.Count -eq 2)
Check '版本倒序' ($r.json.items[0].version -eq 2 -and $r.json.items[1].version -eq 1)
$r = Call GET "/recipes/$id/revisions/1" $null $tok
Check '历史版本 IR 可取' ($r.status -eq 200 -and $r.json.version -eq 1 -and $r.json.ir.steps.Count -eq 3)

# ── 7. 发布：先拒后成 ──
# 先把 IR 破坏回业务非法（借 PATCH），验证发布拦截
$breakBody = @{ ir = ($businessBadIR | ConvertFrom-Json) } | ConvertTo-Json -Depth 10
Call PATCH "/recipes/$id" $breakBody $tok @{ 'If-Match' = '"2"' } | Out-Null

$r = Call POST "/recipes/$id/publish" $null $tok
Check '发布校验失败 → 400' ($r.status -eq 400 -and $r.json.error.code -eq 'recipe.validation_failed')
Check '失败详情定位到规则' (@($r.json.error.details | Where-Object { $_.code -eq 'flow.nothing_in_glass' }).Count -eq 1)

Call PATCH "/recipes/$id" $fixBody $tok @{ 'If-Match' = '"3"' } | Out-Null
$r = Call POST "/recipes/$id/publish" $null $tok
Check '发布成功' ($r.status -eq 200 -and $r.json.status -eq 'published')
Check 'slug 由标题生成' ($r.json.slug -match '^e2e-gin-sour(-\d+)?$')
Check 'publishedAt 已设置' ($null -ne $r.json.publishedAt)
Check 'ABV 服务端计算' ($r.json.abvEst -gt 15 -and $r.json.abvEst -lt 22) "abvEst=$($r.json.abvEst)"
Check '总量含稀释' ($r.json.totalVolumeMl -eq 108) "totalVolumeMl=$($r.json.totalVolumeMl)"
Check 'irVersion 保持 4' ($r.json.irVersion -eq 4)

# 幂等
$r2 = Call POST "/recipes/$id/publish" $null $tok
Check '重复发布幂等' ($r2.status -eq 200 -and $r2.json.slug -eq $r.json.slug)

# ── 8. 投影与计数 ──
$me = Call GET '/me' $null $tok
Check '作者 recipeCount=1' ($me.json.recipeCount -eq 1)
$ginAfter = (Call GET '/ingredients/gin-london-dry').json.recipeCount
Check '原料 recipe_count +1' ($ginAfter -eq ($ginBefore + 1)) "before=$ginBefore after=$ginAfter"
$daiqNow = Call GET '/r/daiquiri'
Check '血缘 derivedCount +1' ($daiqNow.json.derivedCount -eq ($daiqDerivedBefore + 1))

# ── 9. 公开读取 ──
$slug = $r.json.slug
$r = Call GET "/r/$slug"
Check '按 slug 公开可读' ($r.status -eq 200 -and $r.json.id -eq $id)
Check '匿名无 viewerState' ($null -eq $r.json.viewerState)
Check '浏览计数' ($r.json.counts.view -ge 1)
Check '作者信息齐全' ($r.json.author.handle -eq "e2e_r$suffix" -and $r.json.author.displayName)

$r = Call GET "/recipes/$id`?expand=viz" $null $tok
Check '认证带 viewerState' ($r.json.viewerState.liked -eq $false -and $r.json.viewerState.collectedInMenus.Count -eq 0)
Check 'expand=viz 原料' ($r.json.viz.ingredients.'gin-london-dry'.viz.color)
Check 'expand=viz 杯型' ($r.json.viz.glassware.coupe.capacityMl -gt 0)

# ── 10. 已发布配方的编辑保护 ──
$r = Call PATCH "/recipes/$id" $breakBody $tok @{ 'If-Match' = '"4"' }
Check '已发布配方破坏性编辑被拒' ($r.status -eq 400 -and $r.json.error.code -eq 'recipe.validation_failed')

$r = Call PATCH "/recipes/$id" (@{ title = 'E2E Gin Sour Deluxe' } | ConvertTo-Json) $tok @{ 'If-Match' = '"4"' }
Check '元数据编辑成功' ($r.status -eq 200 -and $r.json.recipe.title -eq 'E2E Gin Sour Deluxe')
Check '元数据编辑不递增版本' ($r.json.recipe.irVersion -eq 4)

# ── 11. 撤回与重发布（slug 稳定）──
$r = Call POST "/recipes/$id/unpublish" $null $tok
Check '撤回为草稿' ($r.status -eq 200 -and $r.json.status -eq 'draft')
Check '撤回后 publishedAt 清空' ($null -eq $r.json.publishedAt)
$r = Call GET "/recipes/$id"
Check '撤回后匿名 404' ($r.status -eq 404)
$r = Call GET "/r/$slug"
Check '撤回后 slug 页 404' ($r.status -eq 404)
$me = Call GET '/me' $null $tok
Check '撤回回退 recipeCount' ($me.json.recipeCount -eq 0)

$r = Call POST "/recipes/$id/publish" $null $tok
Check '重新发布' ($r.status -eq 200 -and $r.json.status -eq 'published')
Check 'slug 保持稳定' ($r.json.slug -eq $slug)

# ── 12. 越权 ──
$reg2 = Call POST '/auth/register' (@{
    handle = "e2e_o$suffix"; email = "e2e_o$suffix@test.local"
    password = 'passw0rd-long'; displayName = '路人'
} | ConvertTo-Json)
$tok2 = $reg2.json.accessToken
$r = Call PATCH "/recipes/$id" (@{ title = '劫持' } | ConvertTo-Json) $tok2 @{ 'If-Match' = '"4"' }
Check '他人 PATCH → 403' ($r.status -eq 403 -and $r.json.error.code -eq 'recipe.forbidden')
$r = Call POST "/recipes/$id/publish" $null $tok2
Check '他人发布 → 403' ($r.status -eq 403)

# ── 13. 软删除与级联回退 ──
$r = Call DELETE "/recipes/$id" $null $tok
Check '软删除 → 204' ($r.status -eq 204)
$r = Call GET "/recipes/$id" $null $tok
Check '删除后作者也 404' ($r.status -eq 404)
$me = Call GET '/me' $null $tok
Check '删除回退 recipeCount' ($me.json.recipeCount -eq 0)
$ginFinal = (Call GET '/ingredients/gin-london-dry').json.recipeCount
Check '删除回退原料计数' ($ginFinal -eq $ginBefore)
$daiqFinal = Call GET '/r/daiquiri'
Check '删除回退 derivedCount' ($daiqFinal.json.derivedCount -eq $daiqDerivedBefore)

# ── 14. 404 信封 ──
$r = Call GET '/recipes/00000000-0000-7000-8000-000000000000'
Check '配方 404' ($r.status -eq 404 -and $r.json.error.code -eq 'recipe.not_found')

if ($fail) { Write-Host "`n存在失败项" -ForegroundColor Red; exit 1 }
Write-Host "`n全部通过" -ForegroundColor Green
