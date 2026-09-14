# 通知 + 举报端到端验证（对运行中的本地 API）。
# 覆盖：like/comment/reply/follow 触发 + 发布粉丝扇出 + 自己动作不通知自己
#      + 收件箱分页 + unreadOnly + 未读数 + 指定 ids / 全部标读 + 举报三态。
# 每次运行注册随机新用户、发布配方，可反复执行（结尾软删清理）。
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

$goodIR = @'
{
  "schemaVersion": 1, "glass": "coupe", "method": "shaken", "servings": 1,
  "ingredients": [
    {"slot":"g1","ingredientId":"gin-london-dry","role":"base","unit":"ml","amount":50},
    {"slot":"g2","ingredientId":"lime-juice","role":"souring","unit":"ml","amount":25},
    {"slot":"g3","ingredientId":"simple-syrup","role":"sweetener","unit":"ml","amount":15}
  ],
  "steps": [
    {"action":"ADD","id":"s1","target":"shaker","items":["g1","g2","g3"]},
    {"action":"ICE","id":"s2","target":"shaker","iceType":"cube","fill":0.8},
    {"action":"SHAKE","id":"s3","target":"shaker","durationSec":12,"intensity":"standard"},
    {"action":"STRAIN","id":"s4","from":"shaker","to":"glass","strainer":"hawthorne","double":true}
  ]
}
'@

# ── 0. 甲（粉丝/互动方）乙（作者）──
$suffix = Get-Random -Maximum 1000000
$u1 = Call POST '/auth/register' (@{
    handle = "e2e_p$suffix"; email = "e2e_p$suffix@test.local"
    password = 'passw0rd-long'; displayName = '通知测试甲'
} | ConvertTo-Json)
Check '注册用户甲' ($u1.status -eq 200 -and $u1.json.accessToken)
$tok1 = $u1.json.accessToken
$u2 = Call POST '/auth/register' (@{
    handle = "e2e_q$suffix"; email = "e2e_q$suffix@test.local"
    password = 'passw0rd-long'; displayName = '通知测试乙'
} | ConvertTo-Json)
Check '注册用户乙' ($u2.status -eq 200 -and $u2.json.accessToken)
$tok2 = $u2.json.accessToken
$handle2 = "e2e_q$suffix"

$made = @()
try {
# ── 1. 乙发布 R1（甲还没关注 → 无扇出）──
$r = Call POST '/recipes' (@{
    title = "E2E 通知用配方 1"; lang = 'zh'
    ir = ($goodIR | ConvertFrom-Json)
} | ConvertTo-Json -Depth 10) $tok2
Check '乙创建 R1 → 201' ($r.status -eq 201)
$r1 = $r.json.recipe.id
$made += $r1
Check '发布 R1 → 200' ((Call POST "/recipes/$r1/publish" '{}' $tok2).status -eq 200)

# ── 2. 触发通知：关注 / 点赞 / 评论 / 回复 / 评论点赞 ──
Check '甲关注乙' ((Call PUT "/users/$handle2/follow" '{}' $tok1).status -eq 204)
Check '甲点赞 R1' ((Call PUT "/recipes/$r1/like" '{}' $tok1).status -eq 200)
Check '甲重复点赞 R1（不重复通知）' ((Call PUT "/recipes/$r1/like" '{}' $tok1).status -eq 200)
$c = Call POST "/recipes/$r1/comments" (@{ body = '好配方！' } | ConvertTo-Json) $tok1
Check '甲评论 R1 → 201' ($c.status -eq 201)
$cid = $c.json.id
$rep = Call POST "/recipes/$r1/comments" (@{ body = '谢谢！'; parentId = $cid } | ConvertTo-Json) $tok2
Check '乙回复甲的评论 → 201' ($rep.status -eq 201)
$repid = $rep.json.id
Check '甲点赞乙的回复' ((Call PUT "/comments/$repid/like" '{}' $tok1).status -eq 200)

# 乙自赞 R1：自己通知自己应被抑制
Check '乙自赞 R1' ((Call PUT "/recipes/$r1/like" '{}' $tok2).status -eq 200)

# ── 3. 乙的收件箱：follow + like(recipe) + comment + like(comment) = 4 条 ──
$n = Call GET '/notifications' $null $tok2
Check '乙收件箱 → 200' ($n.status -eq 200)
$items = @($n.json.items)
Check "乙通知数 = 4（实际 $($items.Count)）" ($items.Count -eq 4)
$types = ($items | ForEach-Object { $_.type }) -join ','
Check "类型齐全（最新在前 like,comment,like,follow，实际 $types）" ($types -eq 'like,comment,like,follow')
Check '最新通知 actor 是甲' ($items[0].actor.handle -eq "e2e_p$suffix")
Check 'follow 通知 entity 是 user' ($items[3].entityType -eq 'user')
Check '全未读' (@($items | Where-Object { $null -ne $_.readAt }).Count -eq 0)

$uc = Call GET '/notifications/unread-count' $null $tok2
Check '乙未读数 = 4' ($uc.json.count -eq 4)

# ── 4. 乙发布 R2 → 甲收 system 扇出 ──
$r = Call POST '/recipes' (@{
    title = "E2E 通知用配方 2"; lang = 'zh'
    ir = ($goodIR | ConvertFrom-Json)
} | ConvertTo-Json -Depth 10) $tok2
$r2 = $r.json.recipe.id
$made += $r2
Check '发布 R2 → 200' ((Call POST "/recipes/$r2/publish" '{}' $tok2).status -eq 200)

$n1 = Call GET '/notifications' $null $tok1
# 甲应有 2 条：发布扇出（最新）+ 乙回复其评论的 reply 通知
$items1 = @($n1.json.items)
Check "甲收发布扇出 + 回复通知（实际 $($items1.Count) 条）" ($items1.Count -eq 2 -and $items1[0].type -eq 'system' -and $items1[1].type -eq 'reply')
Check '扇出 payload 带标题' ($items1[0].payload.title -eq 'E2E 通知用配方 2')

# 乙自己的收件箱不应有 R2 扇出（不发自己）
$n2 = Call GET '/notifications' $null $tok2
Check '乙不收自己的发布扇出' (@($n2.json.items).Count -eq 4)

# ── 5. 分页 + unreadOnly ──
$p1 = Call GET '/notifications?limit=2' $null $tok2
Check '分页第一页 2 条 + 游标' (@($p1.json.items).Count -eq 2 -and $p1.json.nextCursor)
$p2 = Call GET "/notifications?limit=2&cursor=$($p1.json.nextCursor)" $null $tok2
Check '分页第二页 2 条' (@($p2.json.items).Count -eq 2)
$ids1 = @($p1.json.items | ForEach-Object { $_.id })
$ids2 = @($p2.json.items | ForEach-Object { $_.id })
Check '两页无重叠' (@($ids1 | Where-Object { $ids2 -contains $_ }).Count -eq 0)

# ── 6. 标读：指定 ids → 剩 2 未读；全部 → 0 ──
$readIds = ConvertTo-Json @($ids1)
Check '指定 ids 标读 → 204' ((Call POST '/notifications/read' "{`"ids`":$readIds}" $tok2).status -eq 204)
$uc = Call GET '/notifications/unread-count' $null $tok2
Check '标读后未读 = 2' ($uc.json.count -eq 2)
$un = Call GET '/notifications?unreadOnly=true' $null $tok2
Check 'unreadOnly 只返回未读' (@($un.json.items).Count -eq 2)
Check '全部标读 → 204' ((Call POST '/notifications/read' '{}' $tok2).status -eq 204)
$uc = Call GET '/notifications/unread-count' $null $tok2
Check '全部标读后未读 = 0' ($uc.json.count -eq 0)

# ── 7. 举报 ──
Check '举报配方 → 204' ((Call POST '/reports' (@{
    entityType = 'recipe'; entityId = $r1; reason = 'spam'; detail = '测试举报'
} | ConvertTo-Json) $tok1).status -eq 204)
$bad = Call POST '/reports' (@{
    entityType = 'recipe'; entityId = '00000000-0000-0000-0000-000000000009'; reason = 'spam'
} | ConvertTo-Json) $tok1
Check '举报不存在的对象 → 404' ($bad.status -eq 404)
$bad = Call POST '/reports' (@{
    entityType = 'planet'; entityId = $r1; reason = 'spam'
} | ConvertTo-Json) $tok1
Check '非法 entityType → 422' ($bad.status -eq 422)
Check '举报评论 → 204' ((Call POST '/reports' (@{
    entityType = 'comment'; entityId = $cid; reason = 'abuse'
} | ConvertTo-Json) $tok1).status -eq 204)

} finally {
    # 清理：软删发布的配方（防污染 Feed 计数），评论随配方级联
    if ($tok2) {
        foreach ($id in $made) { Call DELETE "/recipes/$id" $null $tok2 | Out-Null }
    }
}

if ($fail) { Write-Host "`n存在失败" -ForegroundColor Red; exit 1 }
else { Write-Host "`n全部通过" -ForegroundColor Green }
