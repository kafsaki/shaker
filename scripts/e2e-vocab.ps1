# 词表端点验证（对运行中的本地 API）。
$ErrorActionPreference = 'Stop'
$base = 'http://localhost:8080/api/v1'
$fail = 0

function Check($name, $cond, $extra = '') {
    if ($cond) { Write-Host "PASS  $name" }
    else { Write-Host "FAIL  $name  $extra"; $script:fail = 1 }
}

# ── 1. GET /vocab ──
$req = [System.Net.HttpWebRequest]::Create("$base/vocab")
$req.Method = 'GET'
$resp = $req.GetResponse()
$etag = $resp.Headers['ETag']
$cc = $resp.Headers['Cache-Control']
$stream = $resp.GetResponseStream()
$reader = New-Object System.IO.StreamReader($stream)
$body = $reader.ReadToEnd()
$resp.Close()
$v = $body | ConvertFrom-Json

Check 'vocab 有版本号' ($v.version -is [datetime])
Check 'vocab 有 ETag' ($etag -match '^"[0-9a-f]{16}"$')
Check 'vocab Cache-Control' ($cc -eq 'public, max-age=3600')
Check 'vocab 原料非空' ($v.ingredients.Count -ge 10)
Check 'vocab 杯型非空' ($v.glassware.Count -ge 3)
Check 'vocab 手法非空' ($v.techniques.Count -ge 5)
Check 'vocab 标签非空' ($v.tags.Count -ge 3)
$gin = $v.ingredients | Where-Object { $_.id -eq 'gin-london-dry' }
Check '原料字段齐全' ($gin -and $gin.nameZh -and $gin.category -and $gin.abv -and $gin.viz.color -and $gin.aliases.Count -gt 0)

# ── 2. ETag → 304 ──
$req2 = [System.Net.HttpWebRequest]::Create("$base/vocab")
$req2.Method = 'GET'
$req2.Headers.Add('If-None-Match', $etag)
try {
    $resp2 = $req2.GetResponse()
    $resp2.Close()
    Check 'If-None-Match → 304' ($resp2.StatusCode -eq 304)
} catch [System.Net.WebException] {
    Check 'If-None-Match → 304' ([int]$_.Exception.Response.StatusCode -eq 304)
}

# ── 3. 原料列表 + 筛选 + 搜索 ──
$list = Invoke-RestMethod -Uri "$base/ingredients?limit=5"
Check '原料列表默认分页' ($list.items.Count -eq 5 -and $list.nextCursor)
Check '分页游标有效' ($list.items[0].id -and -not $list.items[0].descriptionZh)

$page2 = Invoke-RestMethod -Uri "$base/ingredients?limit=5&cursor=$($list.nextCursor)"
Check '游标翻页不重叠' (($page2.items | ForEach-Object id) -notcontains $list.items[0].id)

$spirits = Invoke-RestMethod -Uri "$base/ingredients?category=spirit"
Check '分类过滤' ($spirits.items.Count -gt 0 -and ($spirits.items | ForEach-Object category | Select-Object -Unique) -eq 'spirit')

$search = Invoke-RestMethod -Uri "$base/ingredients?q=gin"
Check '英文名搜索' (($search.items | ForEach-Object id) -contains 'gin-london-dry')

$searchZh = Invoke-RestMethod -Uri "$base/ingredients?q=%E9%87%91%E9%85%92"  # 金酒
Check '中文名搜索' (($searchZh.items | ForEach-Object id) -contains 'gin-london-dry')

$alias = Invoke-RestMethod -Uri "$base/ingredients?q=%E7%90%B4%E9%85%92"     # 琴酒（别名）
Check '别名搜索' (($alias.items | ForEach-Object id) -contains 'gin-london-dry')

# ── 4. 原料详情 ──
$detail = Invoke-RestMethod -Uri "$base/ingredients/gin-london-dry"
Check '原料详情' ($detail.id -eq 'gin-london-dry' -and $detail.abv -gt 0 -and ($null -ne $detail.viz))

# ── 5. 404 ──
$code = 0
try { Invoke-RestMethod -Uri "$base/ingredients/no-such-thing" | Out-Null }
catch { $code = [int]$_.Exception.Response.StatusCode; $nf = $_.ErrorDetails.Message }
Check '原料 404' ($code -eq 404)
Check '404 信封' ($nf -match 'ingredient\.not_found')

$code = 0
try { Invoke-RestMethod -Uri "$base/glassware/nope" | Out-Null }
catch { $code = [int]$_.Exception.Response.StatusCode }
Check '杯型 404' ($code -eq 404)

# ── 6. 杯型详情 ──
$glass = Invoke-RestMethod -Uri "$base/glassware/coupe"
Check '杯型详情' ($glass.capacityMl -gt 0 -and $glass.shape)

Write-Host ''
if ($fail -eq 0) { Write-Host 'ALL PASS' -ForegroundColor Green } else { Write-Host 'HAS FAILURES' -ForegroundColor Red; exit 1 }
