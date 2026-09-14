# Feed + 点赞 + 评论 端到端验证（对运行中的本地 API）。
# 覆盖：三条流 + 游标分页 + classic_key 折叠（ADR-013）+ viewerState 批量
#      + 配方/评论点赞幂等 + 一层回复约束 + 评论 CRUD 计数联动。
# 每次运行注册随机新用户、发布带 classicKey 的变体，可反复执行（结尾软删清理）。
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

# ── 0. 两个用户 ──
$suffix = Get-Random -Maximum 1000000
$u1 = Call POST '/auth/register' (@{
    handle = "e2e_f$suffix"; email = "e2e_f$suffix@test.local"
    password = 'passw0rd-long'; displayName = 'Feed 测试甲'
} | ConvertTo-Json)
Check '注册用户甲' ($u1.status -eq 200 -and $u1.json.accessToken)
$tok1 = $u1.json.accessToken
$u2 = Call POST '/auth/register' (@{
    handle = "e2e_g$suffix"; email = "e2e_g$suffix@test.local"
    password = 'passw0rd-long'; displayName = 'Feed 测试乙'
} | ConvertTo-Json)
Check '注册用户乙' ($u2.status -eq 200 -and $u2.json.accessToken)
$tok2 = $u2.json.accessToken

# ── 1. 发布 3 个 daiquiri 变体（+ 种子 canonical = 同 key 4 条 → 触发折叠）──
$variantIds = @()
# try/finally：中途崩溃也保证清理，残留会污染下次运行（折叠计数按全量算）
try {
for ($i = 1; $i -le 3; $i++) {
    $r = Call POST '/recipes' (@{
        title = "E2E Daiquiri 变体 $i"; lang = 'zh'
        classicKey = 'daiquiri'; tags = @('refreshing')
        ir = ($goodIR | ConvertFrom-Json)
    } | ConvertTo-Json -Depth 10) $tok1
    Check "创建变体 $i → 201" ($r.status -eq 201)
    $vid = $r.json.recipe.id
    $variantIds += $vid
    $p = Call POST "/recipes/$vid/publish" '{}' $tok1
    Check "发布变体 $i → 200" ($p.status -eq 200)
}
$rid = $variantIds[0]  # 互动测试目标

# ── 2. 热门流 + 折叠 ──
$r = Call GET '/feed/hot?window=all&limit=50'
Check '热门流 → 200' ($r.status -eq 200)
$items = @($r.json.items)
Check "热门流有内容（$($items.Count) 条，8 发布 − 2 折叠 = 6）" ($items.Count -ge 6)
$daiqs = @($items | Where-Object { $_.classicKey -eq 'daiquiri' })
Check '单页 daiquiri 最多 2 条（ADR-013）' ($daiqs.Count -eq 2) "实际 $($daiqs.Count)"
$first = $daiqs[0]
Check '折叠计数 = 全部 4 − 已展示 2' ($first.collapsedVariants.count -eq 2) "实际 $($first.collapsedVariants | ConvertTo-Json -Compress)"
Check '折叠 URL 指向变体列表' ($first.collapsedVariants.url -eq '/api/v1/classics/daiquiri/variants')
Check '卡片带作者' ($null -ne $first.author -and $first.author.handle)
Check '卡片带标签数组' ($null -ne $first.tags)
# 种子扩充到 59 经典后行数超一页，nextCursor 存在才是正确行为
# （折叠一致性由下方「第二页无重叠」保障）
Check '热门流满页 → 有 nextCursor' ($r.json.nextCursor)

# ── 3. 最新流 + 游标分页 ──
$r = Call GET '/feed/new?limit=3'
Check '最新流 limit=3 → 3 条' ($r.status -eq 200 -and @($r.json.items).Count -eq 3)
$page1 = @($r.json.items | ForEach-Object { $_.id })
Check '最新流首页是新发布的变体' ($page1 -contains $variantIds[2] -and $page1 -contains $variantIds[1])
Check '最新流也折叠（3 条里 daiquiri ≤ 2）' ((@($r.json.items | Where-Object { $_.classicKey -eq 'daiquiri' }).Count -le 2))
Check '分页游标存在' ($r.json.nextCursor)
$r2 = Call GET "/feed/new?limit=3&cursor=$($r.json.nextCursor)"
$page2 = @($r2.json.items | ForEach-Object { $_.id })
Check '第二页无重叠' ((@($page1 | Where-Object { $page2 -contains $_ })).Count -eq 0)

# ── 4. 游标/时间窗校验 ──
$r = Call GET '/feed/hot?cursor=@@invalid@@'
Check '坏游标 → 400' ($r.status -eq 400 -and $r.json.error.code -eq 'cursor.invalid')
$r = Call GET '/feed/hot?window=24h'
Check 'window=24h 有内容（今天发布的种子+变体）' ($r.status -eq 200 -and @($r.json.items).Count -ge 5)
$r = Call GET '/feed/new'
Check 'limit 缺省 → 兜底 20 → 200' ($r.status -eq 200)

# ── 5. 关注流 ──
$r = Call GET '/feed/following'
Check '关注流匿名 → 401' ($r.status -eq 401)
$r = Call GET '/feed/following' $null $tok1
Check '关注流无关注 → 空列表' ($r.status -eq 200 -and @($r.json.items).Count -eq 0)

# ── 6. 配方点赞（幂等 + 计数 + viewerState + 列表）──
$r = Call PUT "/recipes/$rid/like" $null
Check '匿名点赞 → 401' ($r.status -eq 401)
$r = Call PUT "/recipes/$rid/like" $null $tok1
Check '用户甲点赞 → like=1' ($r.status -eq 200 -and $r.json.like -eq 1)
$r = Call PUT "/recipes/$rid/like" $null $tok1
Check '重复点赞幂等 → 仍 like=1' ($r.status -eq 200 -and $r.json.like -eq 1)
$r = Call PUT "/recipes/$rid/like" $null $tok2
Check '用户乙点赞 → like=2' ($r.status -eq 200 -and $r.json.like -eq 2)
$r = Call GET "/recipes/$rid"
Check '详情计数 like=2' ($r.json.counts.like -eq 2)
$r = Call GET '/feed/hot?window=all&limit=50' $null $tok1
$mine = @($r.json.items | Where-Object { $_.id -eq $rid })[0]
Check 'Feed 卡片 viewerState.liked=true' ($mine.viewerState.liked -eq $true)
$r = Call GET "/recipes/$rid/likes"
Check '点赞列表 2 人' ($r.status -eq 200 -and @($r.json.items).Count -eq 2)
Check '点赞列表带用户' ($r.json.items[0].user.handle)
$r = Call DELETE "/recipes/$rid/like" $null $tok1
Check '取消点赞 → like=1' ($r.status -eq 200 -and $r.json.like -eq 1)
$r = Call GET "/recipes/$rid"
Check '详情计数回落 like=1' ($r.json.counts.like -eq 1)

# 草稿/不存在 → 404
$r = Call POST '/recipes' (@{ title = 'x'; ir = ($goodIR | ConvertFrom-Json) } | ConvertTo-Json -Depth 10) $tok1
$draftId = $r.json.recipe.id
$r = Call PUT "/recipes/$draftId/like" $null $tok1
Check '点赞草稿 → 404（不泄露存在性）' ($r.status -eq 404)
$r = Call PUT '/recipes/00000000-0000-7000-8000-000000000000/like' $null $tok1
Check '点赞不存在 → 404' ($r.status -eq 404)
Call DELETE "/recipes/$draftId" $null $tok1 | Out-Null

# ── 7. 评论（一层回复 + 计数联动 + 权限）──
$r = Call POST "/recipes/$rid/comments" '{"body":"第一条顶层评论"}' $null
Check '匿名评论 → 401' ($r.status -eq 401)
$r = Call POST "/recipes/$rid/comments" '{"body":"第一条顶层评论"}' $tok1
Check '用户甲发评论' ($r.status -eq 201 -and $r.json.id)
$c1 = $r.json.id
Check '评论作者正确' ($r.json.author.handle -eq "e2e_f$suffix")
$r = Call POST "/recipes/$rid/comments" '{"body":"第二条顶层评论"}' $tok2
$c2 = $r.json.id
$r = Call POST "/recipes/$rid/comments" (@{ body = '回复第一条'; parentId = $c1 } | ConvertTo-Json) $tok2
Check '用户乙回复 c1' ($r.status -eq 201)
$c3 = $r.json.id
$r = Call POST "/recipes/$rid/comments" (@{ body = '回复的回复'; parentId = $c3 } | ConvertTo-Json) $tok1
Check '回复回复 → 422 只允许一层' ($r.status -eq 422 -and $r.json.error.code -eq 'comment.nesting_not_allowed')
# 跨配方父评论
$r = Call POST "/recipes/$($variantIds[1])/comments" '{"body":"另一配方的评论"}' $tok1
$cOther = $r.json.id
$r = Call POST "/recipes/$rid/comments" (@{ body = 'x'; parentId = $cOther } | ConvertTo-Json) $tok1
Check '跨配方 parentId → 422' ($r.status -eq 422 -and $r.json.error.code -eq 'comment.parent_mismatch')

# 列表 + viewerState
$r = Call GET "/recipes/$rid/comments"
Check '评论列表 2 条顶层' ($r.status -eq 200 -and @($r.json.items).Count -eq 2)
$top1 = @($r.json.items | Where-Object { $_.id -eq $c1 })[0]
Check 'c1 带 1 条回复' (@($top1.replies).Count -eq 1 -and $top1.replies[0].id -eq $c3)
Check 'c1 replyCount=1' ($top1.replyCount -eq 1)
$r = Call GET "/recipes/$rid"
Check '配方 commentCount=3' ($r.json.counts.comment -eq 3)

# 评论点赞
$r = Call PUT "/comments/$c3/like" $null $tok1
Check '评论点赞 → like=1' ($r.status -eq 200 -and $r.json.like -eq 1)
$r = Call PUT "/comments/$c3/like" $null $tok1
Check '评论点赞幂等' ($r.status -eq 200 -and $r.json.like -eq 1)
$r = Call GET "/recipes/$rid/comments" $null $tok1
$top1v = @($r.json.items | Where-Object { $_.id -eq $c1 })[0]
Check '评论列表 viewerState.liked=true' ($top1v.replies[0].viewerState.liked -eq $true)
$r = Call DELETE "/comments/$c3/like" $null $tok1
Check '取消评论点赞 → 0' ($r.status -eq 200 -and $r.json.like -eq 0)

# 编辑/删除权限
$r = Call PATCH "/comments/$c3" '{"body":"改别人的"}' $tok1
Check '编辑他人评论 → 403' ($r.status -eq 403)
$r = Call PATCH "/comments/$c3" '{"body":"用户乙改自己的回复"}' $tok2
Check '作者编辑评论 → 200' ($r.status -eq 200 -and $r.json.body -like '用户乙改*')
$r = Call GET "/comments/$c1/replies"
Check '回复列表 1 条' ($r.status -eq 200 -and @($r.json.items).Count -eq 1)

# 删除回复：reply_count / comment_count 回退
$r = Call DELETE "/comments/$c3" $null $tok1
Check '删他人回复 → 403' ($r.status -eq 403)
$r = Call DELETE "/comments/$c3" $null $tok2
Check '作者删回复 → 204' ($r.status -eq 204)
$r = Call GET "/recipes/$rid/comments"
$top1d = @($r.json.items | Where-Object { $_.id -eq $c1 })[0]
Check 'c1 replyCount 回退到 0' ($top1d.replyCount -eq 0)
$r = Call GET "/recipes/$rid"
Check 'commentCount=2（删了 1 条回复）' ($r.json.counts.comment -eq 2)

# 删顶层：连回复一起
$r = Call POST "/recipes/$rid/comments" (@{ body = 'c1 的又一条回复'; parentId = $c1 } | ConvertTo-Json) $tok2
$c4 = $r.json.id
$r = Call DELETE "/comments/$c1" $null $tok1
Check '删顶层评论（连带回复）→ 204' ($r.status -eq 204)
$r = Call GET "/recipes/$rid"
Check 'commentCount=1（只剩 c2）' ($r.json.counts.comment -eq 1) "实际 $($r.json.counts.comment)"
$r = Call GET "/recipes/$rid/comments"
Check '剩 1 条顶层（c2）' (@($r.json.items).Count -eq 1 -and $r.json.items[0].id -eq $c2)
$r = Call GET "/comments/$c4/replies"
Check '被连带的回复也 404' ($r.status -eq 404)
$r = Call POST "/recipes/00000000-0000-7000-8000-000000000000/comments" '{"body":"x"}' $tok1
Check '评论不存在配方 → 404' ($r.status -eq 404)

# ── 7.5 游标分页补充：回复列表 + 热门流 ──
for ($i = 1; $i -le 5; $i++) {
    Call POST "/recipes/$rid/comments" (@{ body = "分页测试回复 $i"; parentId = $c2 } | ConvertTo-Json) $tok2 | Out-Null
}
$r1 = Call GET "/comments/$c2/replies?limit=2"
Check '回复分页第一页 2 条' (@($r1.json.items).Count -eq 2)
Check '回复分页有游标' ($r1.json.nextCursor)
$r2 = Call GET "/comments/$c2/replies?limit=2&cursor=$($r1.json.nextCursor)"
$rp1 = @($r1.json.items | ForEach-Object { $_.id }); $rp2 = @($r2.json.items | ForEach-Object { $_.id })
Check '回复分页第二页无重叠' ((@($rp1 | Where-Object { $rp2 -contains $_ })).Count -eq 0)
$r3 = Call GET "/comments/$c2/replies?limit=2&cursor=$($r2.json.nextCursor)"
$rp3 = @($r3.json.items | ForEach-Object { $_.id })
Check '回复分页第三页 1 条' ($rp3.Count -eq 1)
Check '回复分页三页合计 5' (($rp1 + $rp2 + $rp3).Count -eq 5)

$h1 = Call GET '/feed/hot?window=all&limit=2'
$hp1 = @($h1.json.items | ForEach-Object { $_.id })
Check '热门流分页有游标' ($h1.json.nextCursor)
$h2 = Call GET "/feed/hot?window=all&limit=2&cursor=$($h1.json.nextCursor)"
$hp2 = @($h2.json.items | ForEach-Object { $_.id })
Check '热门流第二页无重叠' ((@($hp1 | Where-Object { $hp2 -contains $_ })).Count -eq 0)

# ── 8. 清理：软删 3 个变体（finally：崩溃也执行）──
} finally {
    foreach ($vid in $variantIds) {
        if ($vid) { Call DELETE "/recipes/$vid" $null $tok1 | Out-Null }
    }
    $r = Call GET '/feed/new?limit=50'
    $left = @($r.json.items | Where-Object { $_.title -like 'E2E Daiquiri 变体*' })
    Check '清理后 Feed 无测试残留' ($left.Count -eq 0)
}

Write-Host ''
if ($fail) { Write-Host '存在失败项'; exit 1 } else { Write-Host '全部通过' }
