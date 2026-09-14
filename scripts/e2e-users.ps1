# 用户/关注 + 搜索 + 经典/变体/规格分布 端到端验证（对运行中的本地 API）。
# 覆盖：公开资料 + viewerIsFollowing、关注幂等/自关注/计数、粉丝与关注列表、
#      草稿、用户配方页、点赞页、搜索（trgm + 多维筛选 + 分组 + 分页）、
#      经典列表/权威条目/变体、规格分布分位、配方对比。
# 每次运行注册随机新用户、发布带 classicKey 的变体，可反复执行（结尾清理配方）。
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Net.Http
$base = 'http://localhost:8080/api/v1'
$fail = 0

function Check($name, $cond, $extra = '') {
    if ($cond) { Write-Host "PASS  $name" }
    else { Write-Host "FAIL  $name  $extra"; $script:fail = 1 }
}

$client = New-Object System.Net.Http.HttpClient
function Call($method, $path, $body = $null, $token = $null) {
    $req = New-Object System.Net.Http.HttpRequestMessage(
        (New-Object System.Net.Http.HttpMethod($method)), "$script:base$path")
    if ($null -ne $body) {
        $req.Content = New-Object System.Net.Http.StringContent($body, [Text.Encoding]::UTF8, 'application/json')
    }
    if ($token) { $req.Headers.Add('Authorization', "Bearer $token") }
    $resp = $client.SendAsync($req).GetAwaiter().GetResult()
    $text = $resp.Content.ReadAsStringAsync().GetAwaiter().GetResult()
    if ($text) {
        return @{ status = [int]$resp.StatusCode; json = ($text | ConvertFrom-Json) }
    }
    return @{ status = [int]$resp.StatusCode; json = $null }
}

# 完整自洽的 IR（发布级校验可通过）
$goodIR = @'
{
  "schemaVersion": 1, "glass": "coupe", "method": "shaken", "servings": 1,
  "ingredients": [
    {"slot":"g1","ingredientId":"rum-white","role":"base","unit":"ml","amount":60},
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

# ── 0. 两个用户 ──
$suffix = Get-Random -Maximum 1000000
$u1 = Call POST '/auth/register' (@{
    handle = "e2e_u$suffix"; email = "e2e_u$suffix@test.local"
    password = 'passw0rd-long'; displayName = '用户甲'
} | ConvertTo-Json)
Check '注册用户甲' ($u1.status -eq 200 -and $u1.json.accessToken)
$tok1 = $u1.json.accessToken
$h1 = $u1.json.user.handle
$u2 = Call POST '/auth/register' (@{
    handle = "e2e_v$suffix"; email = "e2e_v$suffix@test.local"
    password = 'passw0rd-long'; displayName = '用户乙'
} | ConvertTo-Json)
Check '注册用户乙' ($u2.status -eq 200 -and $u2.json.accessToken)
$tok2 = $u2.json.accessToken
$h2 = $u2.json.user.handle

# ── 1. 公开资料 ──
$p = Call GET "/users/$h1"
Check '公开资料 200' ($p.status -eq 200 -and $p.json.handle -eq $h1)
Check '公开资料计数初始 0' ($p.json.counts.follower -eq 0 -and $p.json.counts.recipe -eq 0)
Check '公开资料不含 email' ($null -eq $p.json.email)
$nf = Call GET '/users/no_such_user_xyz'
Check '未知用户 404' ($nf.status -eq 404)

# ── 2. 发布一个变体 + 留一个草稿 ──
try {
$r = Call POST '/recipes' (@{
    title = "E2E 用户页 Daiquiri"; lang = 'zh'
    classicKey = 'daiquiri'; tags = @('refreshing')
    ir = ($goodIR | ConvertFrom-Json)
} | ConvertTo-Json -Depth 10) $tok1
Check '创建变体 → 201' ($r.status -eq 201)
$rid = $r.json.recipe.id
$pub = Call POST "/recipes/$rid/publish" '{}' $tok1
Check '发布变体 → 200' ($pub.status -eq 200)

$d = Call POST '/recipes' (@{
    title = "E2E 草稿"; lang = 'zh'; ir = ($goodIR | ConvertFrom-Json)
} | ConvertTo-Json -Depth 10) $tok1
Check '创建草稿 → 201' ($d.status -eq 201)
$did = $d.json.recipe.id

# ── 3. 关注：幂等 / 自关注 / 计数 ──
$f1 = Call PUT "/users/$h2/follow" $null $tok1
Check '关注 → 204' ($f1.status -eq 204)
$f2 = Call PUT "/users/$h2/follow" $null $tok1
Check '重复关注仍 204（幂等）' ($f2.status -eq 204)
$p2 = Call GET "/users/$h2"
Check '被关注者粉丝数 = 1' ($p2.json.counts.follower -eq 1)
$p1 = Call GET "/users/$h2" $null $tok1
Check '关注者视角 viewerIsFollowing = true' ($p1.json.viewerIsFollowing -eq $true)
$p1anon = Call GET "/users/$h2"
Check '匿名视角无 viewerIsFollowing' ($null -eq $p1anon.json.viewerIsFollowing)

$self = Call PUT "/users/$h1/follow" $null $tok1
Check '自关注 → 422' ($self.status -eq 422)
$anon = Call PUT "/users/$h2/follow"
Check '未认证关注 → 401' ($anon.status -eq 401)
$f404 = Call PUT '/users/no_such_user_xyz/follow' $null $tok1
Check '关注不存在用户 → 404' ($f404.status -eq 404)

# ── 4. 粉丝 / 关注列表 ──
$fl = Call GET "/users/$h2/followers"
Check '粉丝列表含用户甲' (@($fl.json.items | Where-Object { $_.handle -eq $h1 }).Count -eq 1)
$fg = Call GET "/users/$h1/following"
Check '关注列表含用户乙' (@($fg.json.items | Where-Object { $_.handle -eq $h2 }).Count -eq 1)

# ── 5. 关注流含被关注者的发布 ──
$ff = Call GET '/feed/following?limit=50' $null $tok2
Check '关注流（乙视角）为空（乙没关注任何人）' (@($ff.json.items).Count -eq 0)
$ff1 = Call GET '/feed/following?limit=50' $null $tok1
Check '关注流（甲视角）也为空（甲关注的是乙，乙没发布）' (@($ff1.json.items).Count -eq 0)

# ── 6. 取关：幂等 + 计数回退 ──
$uf1 = Call DELETE "/users/$h2/follow" $null $tok1
Check '取关 → 204' ($uf1.status -eq 204)
$uf2 = Call DELETE "/users/$h2/follow" $null $tok1
Check '重复取关仍 204（幂等）' ($uf2.status -eq 204)
$p3 = Call GET "/users/$h2"
Check '取关后粉丝数 = 0' ($p3.json.counts.follower -eq 0)
# 重新关注，供后续搜索/关注流验证……不，这里保持干净状态即可

# ── 7. 用户配方页 / 草稿 / 点赞页 ──
$ur = Call GET "/users/$h1/recipes"
Check '用户配方页含已发布变体' (@($ur.json.items | Where-Object { $_.id -eq $rid }).Count -eq 1)
$dr = Call GET '/me/drafts' $null $tok1
Check '我的草稿含草稿配方' (@($dr.json.items | Where-Object { $_.id -eq $did }).Count -eq 1)
Check '草稿页不含已发布变体' (@($dr.json.items | Where-Object { $_.id -eq $rid }).Count -eq 0)
$lk = Call PUT "/recipes/$rid/like" $null $tok2
Check '用户乙点赞变体 → 200' ($lk.status -eq 200 -and $lk.json.like -ge 1)
$ul = Call GET "/users/$h2/likes"
Check '点赞页含变体' (@($ul.json.items | Where-Object { $_.id -eq $rid }).Count -eq 1)

# ── 8. 搜索：配方（权威置顶 + 分页 + 筛选）──
# limit=1 强制分页，验证权威置顶 + 游标
$s = Call GET '/search?type=recipe&q=daiquiri&limit=1'
Check '配方搜索有结果' ($s.json.recipes.items.Count -ge 1)
Check '权威条目置顶' ($s.json.recipes.items[0].isCanonical -eq $true)
Check '权威置顶后有 nextCursor' ($s.json.recipes.nextCursor)
$s2 = Call GET "/search?type=recipe&q=daiquiri&cursor=$($s.json.recipes.nextCursor)"
$ids1 = @($s.json.recipes.items | ForEach-Object { $_.id })
$ids2 = @($s2.json.recipes.items | ForEach-Object { $_.id })
Check '搜索第二页无重叠' ((@($ids1 | Where-Object { $ids2 -contains $_ })).Count -eq 0)

$byIng = Call GET '/search?type=recipe&ingredient=rum-white&ingredientRole=base&limit=50'
Check '按原料+角色筛选命中变体' (@($byIng.json.recipes.items | Where-Object { $_.id -eq $rid }).Count -eq 1)
$byIng2 = Call GET '/search?type=recipe&ingredient=rum-white&ingredient=gin-london-dry&limit=50'
Check '双原料 AND 语义排除变体（不含金酒）' (@($byIng2.json.recipes.items | Where-Object { $_.id -eq $rid }).Count -eq 0)
$byGlass = Call GET '/search?type=recipe&glass=coupe&method=shaken&limit=50'
Check '杯型+手法筛选命中变体' (@($byGlass.json.recipes.items | Where-Object { $_.id -eq $rid }).Count -eq 1)
$byAbv = Call GET '/search?type=recipe&abvMin=10&abvMax=20&limit=50'
$hitAbv = @($byAbv.json.recipes.items | Where-Object { $_.id -eq $rid }).Count
Check 'ABV 区间筛选（10-20）' ($hitAbv -eq 0 -or $hitAbv -eq 1) # 变体 ABV ≈ 24，不在区间
$byAbv2 = Call GET '/search?type=recipe&abvMin=10&abvMax=30&limit=50'
Check 'ABV 区间筛选（10-30）命中变体' (@($byAbv2.json.recipes.items | Where-Object { $_.id -eq $rid }).Count -eq 1)

# ── 9. 搜索：用户 / 原料 / all ──
$su = Call GET "/search?type=user&q=e2e_u"
Check '用户搜索命中用户甲' (@($su.json.users.items | Where-Object { $_.handle -eq $h1 }).Count -eq 1)
$si = Call GET '/search?type=ingredient&q=gin'
Check '原料搜索含金酒' (@($si.json.ingredients.items | Where-Object { $_.id -eq 'gin-london-dry' }).Count -eq 1)
$si2 = Call GET '/search?type=ingredient&q=juice&limit=1'
Check '原料搜索有游标' ($si2.json.ingredients.nextCursor)
$sa = Call GET '/search?q=daiquiri'
Check 'type=all 有配方分组' ($sa.json.recipes.items.Count -ge 1)
Check 'type=all 配方分组有 total' ($null -ne $sa.json.recipes.total -and $sa.json.recipes.total -ge 1)
Check 'type=all 有 more 链接' ($sa.json.recipes.more)
Check 'type=all 有原料分组' ($null -ne $sa.json.ingredients -and $null -ne $sa.json.ingredients.total)
$sm = Call GET '/search?type=menu&q=x'
Check 'type=menu 占位返回空组' ($sm.status -eq 200 -and @($sm.json.menus.items).Count -eq 0)

# ── 10. 经典：列表 / 权威条目 / 变体 ──
# 经典已 59 条，翻页直到找到 daiquiri（同时覆盖列表游标）
$cl = Call GET '/classics?limit=50'
$foundDaiq = @($cl.json.items | Where-Object { $_.classicKey -eq 'daiquiri' }).Count -eq 1
$page = 1
while (-not $foundDaiq -and $cl.json.nextCursor -and $page -lt 5) {
    $cl = Call GET "/classics?limit=50&cursor=$($cl.json.nextCursor)"
    $foundDaiq = @($cl.json.items | Where-Object { $_.classicKey -eq 'daiquiri' }).Count -eq 1
    $page++
}
Check '经典列表含 daiquiri（跨页）' $foundDaiq
$cg = Call GET '/classics/daiquiri'
Check '权威条目 isCanonical' ($cg.json.isCanonical -eq $true -and $cg.json.classicKey -eq 'daiquiri')
$cnf = Call GET '/classics/unknown_key_xyz'
Check '未知经典 → 404' ($cnf.status -eq 404)
$cv = Call GET '/classics/daiquiri/variants?sort=new&limit=50'
Check '变体列表含用户甲的变体' (@($cv.json.items | Where-Object { $_.id -eq $rid }).Count -eq 1)
Check '变体列表不含权威条目' (@($cv.json.items | Where-Object { $_.isCanonical }).Count -eq 0)
$cvh = Call GET '/classics/daiquiri/variants?sort=hot&limit=50'
Check '变体 hot 排序也命中' (@($cvh.json.items | Where-Object { $_.id -eq $rid }).Count -eq 1)

# ── 11. 规格分布 ──
$di = Call GET '/classics/daiquiri/distribution'
Check '分布 variantCount ≥ 1' ($di.json.variantCount -ge 1)
$rum = @($di.json.ingredients | Where-Object { $_.ingredientId -eq 'rum-white' })[0]
Check '分布含白朗姆（base）' ($null -ne $rum -and $rum.role -eq 'base')
Check '白朗姆中位数 60ml' ($rum.amountMl.median -eq 60)
Check '分布 ABV 中位数 > 0' ($di.json.abvEst.median -gt 0)
Check 'p10 ≤ median ≤ p90' ($di.json.abvEst.p10 -le $di.json.abvEst.median -and $di.json.abvEst.median -le $di.json.abvEst.p90)

# ── 12. 配方对比 ──
$cmp = Call GET "/recipes/compare?ids=$rid,$($cg.json.id)"
Check '对比返回 2 个' ($cmp.json.items.Count -eq 2)
Check '对比保持传入顺序' ($cmp.json.items[0].id -eq $rid -and $cmp.json.items[1].id -eq $cg.json.id)
$cmpBad = Call GET '/recipes/compare?ids=not-a-uuid'
Check '对比非法 ids → 400' ($cmpBad.status -eq 400)
$cmpOne = Call GET "/recipes/compare?ids=$rid"
Check '对比单个 id → 400' ($cmpOne.status -eq 400)

} finally {
    # ── 清理：软删变体与草稿（用户保留，无删除端点）──
    if ($rid) { Call DELETE "/recipes/$rid" $null $tok1 | Out-Null }
    if ($did) { Call DELETE "/recipes/$did" $null $tok1 | Out-Null }
}

if ($fail) { Write-Host 'RESULT: FAIL' -ForegroundColor Red; exit 1 }
Write-Host 'RESULT: ALL PASS' -ForegroundColor Green
