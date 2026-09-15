# 酒单端到端验证（对运行中的本地 API）。
# 覆盖：CRUD + 可见性鉴权（private/unlisted/public）+ 分享令牌 + 幂等加入
#      + numeric 中点重排 + containsRecipe 标记 + 公开酒单列表。
# 每次运行注册随机新用户、复用种子经典配方，可反复执行（结尾软删清理）。
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

# ── 0. 两个用户 ──
$suffix = Get-Random -Maximum 1000000
$u1 = Call POST '/auth/register' (@{
    handle = "e2e_m$suffix"; email = "e2e_m$suffix@test.local"
    password = 'passw0rd-long'; displayName = '酒单测试甲'
} | ConvertTo-Json)
Check '注册用户甲' ($u1.status -eq 200 -and $u1.json.accessToken)
$tok1 = $u1.json.accessToken
$u2 = Call POST '/auth/register' (@{
    handle = "e2e_n$suffix"; email = "e2e_n$suffix@test.local"
    password = 'passw0rd-long'; displayName = '酒单测试乙'
} | ConvertTo-Json)
Check '注册用户乙' ($u2.status -eq 200 -and $u2.json.accessToken)
$tok2 = $u2.json.accessToken
$handle1 = "e2e_m$suffix"

try {
# ── 1. 建 3 个酒单（private 默认 / unlisted / public）──
$m1 = Call POST '/menus' (@{ title = '我的私藏'; description = '测试私密' } | ConvertTo-Json) $tok1
Check '建私密酒单 → 201' ($m1.status -eq 201)
$menu1 = $m1.json.id
Check '默认 visibility = private' ($m1.json.visibility -eq 'private')
Check 'itemCount = 0' ($m1.json.itemCount -eq 0)

$m2 = Call POST '/menus' (@{ title = '给朋友的清单'; visibility = 'unlisted' } | ConvertTo-Json) $tok1
Check '建 unlisted 酒单 → 201' ($m2.status -eq 201)
$menu2 = $m2.json.id
$m3 = Call POST '/menus' (@{ title = '公开推荐'; visibility = 'public' } | ConvertTo-Json) $tok1
Check '建公开酒单 → 201' ($m3.status -eq 201)
$menu3 = $m3.json.id

$bad = Call POST '/menus' (@{ title = 'x'; visibility = 'friends' } | ConvertTo-Json) $tok1
Check '非法 visibility → 422' ($bad.status -eq 422)

# ── 2. 可见性鉴权 ──
$r = Call GET "/menus/$menu3"
Check '匿名读公开酒单 → 200' ($r.status -eq 200)
$r = Call GET "/menus/$menu1"
Check '匿名读私密 → 404' ($r.status -eq 404)
$r = Call GET "/menus/$menu1" $null $tok2
Check '他人读私密 → 404' ($r.status -eq 404)
$r = Call GET "/menus/$menu1" $null $tok1
Check '主人读私密 → 200' ($r.status -eq 200)
$r = Call GET "/menus/$menu2" $null $tok2
Check '他人按 id 读 unlisted → 404（分享走 token）' ($r.status -eq 404)

# ── 3. 分享令牌 ──
$sh = Call POST "/menus/$menu2/share" '{}' $tok1
Check '生成分享令牌 → 200' ($sh.status -eq 200 -and $sh.json.shareToken.Length -ge 16)
$token = $sh.json.shareToken
$r = Call GET "/menus/shared/$token" $null $tok2
Check '分享链接读 unlisted → 200' ($r.status -eq 200)
Check '分享响应不含 shareToken' ($null -eq $r.json.shareToken)
$sh2 = Call POST "/menus/$menu2/share" '{}' $tok1
Check '轮换令牌 → 新值' ($sh2.json.shareToken -ne $token)
$r = Call GET "/menus/shared/$token" $null $tok2
Check '旧令牌失效 → 404' ($r.status -eq 404)
$r = Call GET "/menus/shared/aaaaaaaaaaaaaaaaaaaaaaaaaa"
Check '瞎猜令牌 → 404' ($r.status -eq 404)

# ── 4. 加配方（幂等）+ 重排 ──
# 种子经典：daiquiri / negroni / mojito（经典锚点直达权威条目，拿短号再取）
$rids = @()
foreach ($key in 'daiquiri', 'negroni', 'mojito') {
    $d = Call GET "/classics/$key"
    $rids += $d.json.id
}
$note = @{ note = '夏天喝' } | ConvertTo-Json
$r = Call PUT "/menus/$menu1/items/$($rids[0])" $note $tok1
Check '加入 daiquiri → 204' ($r.status -eq 204)
$r = Call PUT "/menus/$menu1/items/$($rids[1])" '{}' $tok1
Check '加入 negroni → 204' ($r.status -eq 204)
$r = Call PUT "/menus/$menu1/items/$($rids[2])" '{}' $tok1
Check '加入 mojito → 204' ($r.status -eq 204)
$r = Call PUT "/menus/$menu1/items/$($rids[0])" $note $tok1
Check '重复加入 → 幂等 204' ($r.status -eq 204)

$r = Call GET "/menus/$menu1" $null $tok1
Check 'itemCount = 3' ($r.json.menu.itemCount -eq 3)
$titles = @($r.json.items | ForEach-Object { $_.recipe.classicKey })
Check "初始顺序 daiquiri,negroni,mojito（实际 $($titles -join ',')）" ($titles -join ',' -eq 'daiquiri,negroni,mojito')
Check 'note 已存' ($r.json.items[0].note -eq '夏天喝')
Check '条目含配方卡片' ($r.json.items[0].recipe.isCanonical -eq $true)

# mojito 移到最前
$r = Call POST "/menus/$menu1/items/reorder" (@{ recipeId = $rids[2] } | ConvertTo-Json) $tok1
Check '无锚点重排（移到最前）→ 204' ($r.status -eq 204)
# negroni 插到 mojito 与 daiquiri 之间（锚点 mojito）
$r = Call POST "/menus/$menu1/items/reorder" (@{ recipeId = $rids[1]; afterRecipeId = $rids[2] } | ConvertTo-Json) $tok1
Check '锚点重排 → 204' ($r.status -eq 204)
$r = Call GET "/menus/$menu1" $null $tok1
$titles = @($r.json.items | ForEach-Object { $_.recipe.classicKey })
Check "重排后 mojito,negroni,daiquiri（实际 $($titles -join ',')）" ($titles -join ',' -eq 'mojito,negroni,daiquiri')

# 坏锚点
$r = Call POST "/menus/$menu1/items/reorder" (@{ recipeId = $rids[0]; afterRecipeId = '00000000-0000-0000-0000-000000000001' } | ConvertTo-Json) $tok1
Check '锚点不在酒单 → 422' ($r.status -eq 422)

# 不存在的配方
$r = Call PUT "/menus/$menu1/items/00000000-0000-0000-0000-000000000002" '{}' $tok1
Check '加不存在的配方 → 404' ($r.status -eq 404)

# 他人操作 → 403
$r = Call PUT "/menus/$menu1/items/$($rids[0])" '{}' $tok2
Check '他人加条目 → 403' ($r.status -eq 403)
$r = Call POST "/menus/$menu1/items/reorder" (@{ recipeId = $rids[0] } | ConvertTo-Json) $tok2
Check '他人重排 → 403' ($r.status -eq 403)

# ── 5. /me/menus + containsRecipe ──
$r = Call GET '/me/menus' $null $tok1
Check '/me/menus → 3 个' (@($r.json.items).Count -eq 3)
$r = Call GET "/me/menus?containsRecipe=$($rids[0])" $null $tok1
$marks = @($r.json.items | ForEach-Object { "$($_.title)=$($_.containsRecipe)" })
Check "containsRecipe 标记（实际 $($marks -join ', ')）" (
    (@($r.json.items | Where-Object { $_.id -eq $menu1 }).containsRecipe) -and
    (-not (@($r.json.items | Where-Object { $_.id -eq $menu2 }).containsRecipe)) -and
    (-not (@($r.json.items | Where-Object { $_.id -eq $menu3 }).containsRecipe)))

# ── 6. 移出 + PATCH + 公开列表 ──
$r = Call DELETE "/menus/$menu1/items/$($rids[2])" $null $tok1
Check '移出 mojito → 204' ($r.status -eq 204)
$r = Call DELETE "/menus/$menu1/items/$($rids[2])" $null $tok1
Check '重复移出 → 幂等 204' ($r.status -eq 204)
$r = Call GET "/menus/$menu1" $null $tok1
Check '移出后 itemCount = 2' ($r.json.menu.itemCount -eq 2)

$r = Call PATCH "/menus/$menu3" (@{ title = '公开推荐（改）' } | ConvertTo-Json) $tok1
Check 'PATCH 标题 → 200' ($r.status -eq 200 -and $r.json.title -eq '公开推荐（改）')
$r = Call PATCH "/menus/$menu3" (@{ title = 'x' } | ConvertTo-Json) $tok2
Check '他人 PATCH → 403' ($r.status -eq 403)

$r = Call GET "/users/$handle1/menus"
Check '公开酒单列表 → 只有 1 个' (@($r.json.items).Count -eq 1)
Check '公开列表标题正确' ($r.json.items[0].title -eq '公开推荐（改）')
Check '公开列表不含 shareToken' ($null -eq $r.json.items[0].shareToken)

# 本人视角：全部酒单（private/unlisted/public）+ 附带 shareToken
$r = Call GET "/users/$handle1/menus" $null $tok1
Check '本人酒单列表 → 3 个（含私密/unlisted）' (@($r.json.items).Count -eq 3)
$m2row = @($r.json.items | Where-Object { $_.id -eq $menu2 })[0]
Check '本人列表 unlisted 附带最新 shareToken' ($m2row.shareToken -eq $sh2.json.shareToken)
$r = Call GET "/users/$handle1/menus" $null $tok2
Check '他人视角 → 仅公开 1 个' (@($r.json.items).Count -eq 1)

# ── 7. 删除 ──
$r = Call DELETE "/menus/$menu3" $null $tok1
Check '删除 → 204' ($r.status -eq 204)
$r = Call GET "/menus/$menu3"
Check '删后读取 → 404' ($r.status -eq 404)
$r = Call GET "/users/$handle1/menus"
Check '删后公开列表为空' (@($r.json.items).Count -eq 0)
$r = Call GET "/users/$handle1/menus" $null $tok1
Check '删后本人列表 → 剩 2 个' (@($r.json.items).Count -eq 2)

} finally {
    # 清理：软删剩余酒单（防残留影响下次 containsRecipe 断言）
    if ($tok1) {
        Call DELETE "/menus/$menu1" $null $tok1 | Out-Null
        Call DELETE "/menus/$menu2" $null $tok1 | Out-Null
    }
}

if ($fail) { Write-Host "`n存在失败" -ForegroundColor Red; exit 1 }
else { Write-Host "`n全部通过" -ForegroundColor Green }

