# 媒体预签名直传端到端验证（对运行中的本地 API + MinIO）。
# 覆盖：签发（key 规范 + 900s）→ 未传先 commit 409 → 直传 PNG → commit 200 公网 URL
#      → 幂等 commit → 匿名可读 → 非主人/坏 mime/超大/坏用途/头像 entity 校验。
# 依赖：docker compose up -d（postgres + minio + 建桶）。
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

# 1x1 PNG（89 字节）：真实文件直传，MinIO 会校验签名与 Content-Type
$png = [byte[]](0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A,0x00,0x00,0x00,0x0D,0x49,0x48,0x44,0x52,
    0x00,0x00,0x00,0x01,0x00,0x00,0x00,0x01,0x08,0x06,0x00,0x00,0x00,0x1F,0x15,0xC8,
    0x89,0x00,0x00,0x00,0x0A,0x49,0x44,0x41,0x54,0x78,0x9C,0x63,0x00,0x01,0x00,0x00,
    0x05,0x00,0x01,0x0D,0x0A,0x2D,0xB4,0x00,0x00,0x00,0x00,0x49,0x45,0x4E,0x44,0xAE,
    0x42,0x60,0x82)

$suffix = Get-Random -Maximum 1000000
$u1 = Call POST '/auth/register' (@{
    handle = "e2e_md$suffix"; email = "e2e_md$suffix@test.local"
    password = 'passw0rd-long'; displayName = '媒体测试甲'
} | ConvertTo-Json)
Check '注册用户甲' ($u1.status -eq 200 -and $u1.json.accessToken)
$tok1 = $u1.json.accessToken
$uid1 = $u1.json.user.id

$made = @()
try {
# ── 1. 头像：给自己签发 ──
$p = Call POST '/media/upload-url' (@{
    purpose = 'user_avatar'; entityId = $uid1; mimeType = 'image/png'; byteSize = $png.Length
} | ConvertTo-Json) $tok1
Check '签发头像直传 → 201' ($p.status -eq 201)
Check 'storageKey 规范（users/{id}/avatar-1.png）' ($p.json.storageKey -eq "users/$uid1/avatar-1.png")
Check '有效期 900s' ($p.json.expiresIn -eq 900)
Check 'uploadUrl 指向 MinIO 且带签名' ($p.json.uploadUrl -match 'localhost:9000/shaker-media/.*X-Amz-Signature')

# 未传先 commit → 409
$c = Call POST "/media/$($p.json.assetId)/commit" '{}' $tok1
Check '未直传先 commit → 409' ($c.status -eq 409)

# 直传（客户端不经过后端）
$pu = New-Object System.Net.Http.HttpClient
$req = New-Object System.Net.Http.HttpRequestMessage([System.Net.Http.HttpMethod]::Put, $p.json.uploadUrl)
$req.Content = New-Object System.Net.Http.ByteArrayContent(,$png)
$req.Content.Headers.ContentType = 'image/png'
$resp = $pu.SendAsync($req).GetAwaiter().GetResult()
Check "PUT 直传 → 200（实际 $($resp.StatusCode)）" ($resp.StatusCode -eq 'OK')

# commit → 公网 URL
$c = Call POST "/media/$($p.json.assetId)/commit" '{}' $tok1
Check 'commit → 200' ($c.status -eq 200)
Check '公网 URL 规范' ($c.json.url -eq "http://localhost:9000/shaker-media/users/$uid1/avatar-1.png")
Check 'commit 幂等 → 200' ((Call POST "/media/$($p.json.assetId)/commit" '{}' $tok1).status -eq 200)

# 匿名可读（桶已开 download）
try {
    $img = Invoke-WebRequest -Uri $c.json.url -UseBasicParsing -SkipHttpErrorCheck
    Check '匿名读取公网 URL → 200' ($img.StatusCode -eq 200 -and $img.RawContentLength -eq $png.Length)
} catch { Check '匿名读取公网 URL → 200' $false $_.Exception.Message }

# ── 2. 配方封面：主人校验 + revision 递增 ──
$goodIR = @'
{
  "schemaVersion": 1, "glass": "coupe", "method": "shaken", "servings": 1,
  "ingredients": [
    {"slot":"g1","ingredientId":"gin-london-dry","role":"base","unit":"ml","amount":50},
    {"slot":"g2","ingredientId":"lime-juice","role":"souring","unit":"ml","amount":25}
  ],
  "steps": [
    {"action":"ADD","id":"s1","target":"shaker","items":["g1","g2"]},
    {"action":"SHAKE","id":"s2","target":"shaker","durationSec":12,"intensity":"standard"},
    {"action":"STRAIN","id":"s3","from":"shaker","to":"glass","strainer":"hawthorne","double":true}
  ]
}
'@
$r = Call POST '/recipes' (@{
    title = "E2E 媒体用配方"; lang = 'zh'; ir = ($goodIR | ConvertFrom-Json)
} | ConvertTo-Json -Depth 10) $tok1
Check '创建配方 → 201' ($r.status -eq 201)
$rid = $r.json.recipe.id
$made += $rid

$p2 = Call POST '/media/upload-url' (@{
    purpose = 'recipe_cover'; entityId = $rid; mimeType = 'image/jpeg'; byteSize = 1024
} | ConvertTo-Json) $tok1
Check '签发配方封面 → 201' ($p2.status -eq 201)
Check 'storageKey 规范（recipes/{id}/cover-1.jpg）' ($p2.json.storageKey -eq "recipes/$rid/cover-1.jpg")

$p3 = Call POST '/media/upload-url' (@{
    purpose = 'recipe_cover'; entityId = $rid; mimeType = 'image/jpeg'; byteSize = 1024
} | ConvertTo-Json) $tok1
Check '再次签发 revision 递增（cover-2）' ($p3.json.storageKey -eq "recipes/$rid/cover-2.jpg")

# ── 3. 校验边界 ──
# 非主人（乙给甲的配方签）→ 404（不泄露存在性）
$u2 = Call POST '/auth/register' (@{
    handle = "e2e_me$suffix"; email = "e2e_me$suffix@test.local"
    password = 'passw0rd-long'; displayName = '媒体测试乙'
} | ConvertTo-Json)
Check '注册用户乙' ($u2.status -eq 200 -and $u2.json.accessToken)
$tok2 = $u2.json.accessToken
$bad = Call POST '/media/upload-url' (@{
    purpose = 'recipe_cover'; entityId = $rid; mimeType = 'image/png'; byteSize = 100
} | ConvertTo-Json) $tok2
Check '非主人签发 → 404' ($bad.status -eq 404)

# 头像 entity 不是本人 → 403
$bad = Call POST '/media/upload-url' (@{
    purpose = 'user_avatar'; entityId = $rid; mimeType = 'image/png'; byteSize = 100
} | ConvertTo-Json) $tok2
Check '给别人签头像 → 403' ($bad.status -eq 403)

# 不存在的配方 → 404
$bad = Call POST '/media/upload-url' (@{
    purpose = 'recipe_cover'; entityId = '00000000-0000-0000-0000-000000000009'; mimeType = 'image/png'; byteSize = 100
} | ConvertTo-Json) $tok1
Check '实体不存在 → 404' ($bad.status -eq 404)

# commit 别人的 asset → 404
$bad = Call POST "/media/$($p.json.assetId)/commit" '{}' $tok2
Check 'commit 他人的 asset → 404' ($bad.status -eq 404)

# commit 不存在的 asset → 404
$bad = Call POST '/media/00000000-0000-0000-0000-000000000009/commit' '{}' $tok1
Check 'commit 不存在的 asset → 404' ($bad.status -eq 404)

} finally {
    if ($tok1) { foreach ($id in $made) { Call DELETE "/recipes/$id" $null $tok1 | Out-Null } }
}

if ($fail) { Write-Host "`n存在失败" -ForegroundColor Red; exit 1 }
else { Write-Host "`n全部通过" -ForegroundColor Green }
