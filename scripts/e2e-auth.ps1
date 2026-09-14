# 认证端点端到端验证（对运行中的本地 API）。
# 用法：先启动 API（go run ./cmd/api），再运行本脚本。
# 注意：限流是内存态，同一小时内的重复运行可能撞 register/login 限流（429 属预期行为）；
# 需要立刻重跑时重启 API 进程即可复位。
$ErrorActionPreference = 'Stop'
$base = 'http://localhost:8080/api/v1'
$fail = 0
$handle = 'e2e' + (Get-Random -Maximum 100000)

function Check($name, $cond, $extra = '') {
    if ($cond) { Write-Host "PASS  $name" }
    else { Write-Host "FAIL  $name  $extra"; $script:fail = 1 }
}

# ── 1. 注册 ──
$body = @{ handle = $handle; email = "$handle@example.com"; password = 'correct-horse-battery'; displayName = 'Kafka' } | ConvertTo-Json
try {
    $reg = Invoke-RestMethod -Uri "$base/auth/register" -Method Post -ContentType 'application/json' -Body $body
} catch {
    $reg = $null
}
Check 'register 返回令牌对' ($reg -and $reg.accessToken -and $reg.refreshToken -and $reg.expiresIn -eq 900)
Check 'register 返回用户' ($reg.user.handle -eq $handle -and $reg.user.unitPreference -eq 'ml')
$access = $reg.accessToken
$refresh1 = $reg.refreshToken

# ── 2. 重复注册 → 409 ──
$code = 0
try { Invoke-RestMethod -Uri "$base/auth/register" -Method Post -ContentType 'application/json' -Body $body | Out-Null }
catch { $code = [int]$_.Exception.Response.StatusCode; $dupBody = $_.ErrorDetails.Message }
Check '重复注册 409' ($code -eq 409)
Check '409 错误信封' ($dupBody -match 'auth\.(handle|email)_taken')

# ── 3. GET /me ──
$me = Invoke-RestMethod -Uri "$base/me" -Headers @{ Authorization = "Bearer $access" }
Check 'GET /me' ($me.handle -eq $handle)

# ── 4. PATCH /me ──
$patch = @{ unitPreference = 'oz'; bio = 'shaker dev' } | ConvertTo-Json
$me2 = Invoke-RestMethod -Uri "$base/me" -Method Patch -ContentType 'application/json' -Headers @{ Authorization = "Bearer $access" } -Body $patch
Check 'PATCH /me 改偏好' ($me2.unitPreference -eq 'oz' -and $me2.bio -eq 'shaker dev')

# ── 5. 未认证访问 /me → 401 ──
$code = 0
try { Invoke-RestMethod -Uri "$base/me" | Out-Null } catch { $code = [int]$_.Exception.Response.StatusCode; $noAuth = $_.ErrorDetails.Message }
Check '未认证 401' ($code -eq 401)
Check '401 错误信封' ($noAuth -match '"code":\s*"auth\.unauthorized"')

# ── 6. 刷新轮转 ──
$ref = Invoke-RestMethod -Uri "$base/auth/refresh" -Method Post -ContentType 'application/json' -Body (@{ refreshToken = $refresh1 } | ConvertTo-Json)
Check '刷新返回新令牌对' ($ref.accessToken -and $ref.refreshToken -and $ref.refreshToken -ne $refresh1)
$refresh2 = $ref.refreshToken

# ── 7. 旧令牌重用 → 撤销全部会话 ──
$code = 0
try { Invoke-RestMethod -Uri "$base/auth/refresh" -Method Post -ContentType 'application/json' -Body (@{ refreshToken = $refresh1 } | ConvertTo-Json) | Out-Null }
catch { $code = [int]$_.Exception.Response.StatusCode; $reuseBody = $_.ErrorDetails.Message }
Check '重放旧令牌 401' ($code -eq 401)
Check '重用检测错误码' ($reuseBody -match 'auth\.refresh_reused')

# refresh2 也应已被连坐撤销
$code = 0
try { Invoke-RestMethod -Uri "$base/auth/refresh" -Method Post -ContentType 'application/json' -Body (@{ refreshToken = $refresh2 } | ConvertTo-Json) | Out-Null }
catch { $code = [int]$_.Exception.Response.StatusCode }
Check '连坐撤销 refresh2' ($code -eq 401)

# ── 8. 重新登录 + 改密 ──
$login = Invoke-RestMethod -Uri "$base/auth/login" -Method Post -ContentType 'application/json' -Body (@{ identifier = "$handle@example.com"; password = 'correct-horse-battery' } | ConvertTo-Json)
Check 'email 登录' ($login.accessToken)
$access3 = $login.accessToken

$code = 0
try {
    Invoke-RestMethod -Uri "$base/me/password" -Method Post -ContentType 'application/json' -Headers @{ Authorization = "Bearer $access3" } -Body (@{ currentPassword = 'wrong-password-xx'; newPassword = 'new-staple-battery9' } | ConvertTo-Json) | Out-Null
} catch { $code = [int]$_.Exception.Response.StatusCode; $wrong = $_.ErrorDetails.Message }
Check '错误旧密码 403' ($code -eq 403)
Check '错误旧密码错误码' ($wrong -match 'auth\.wrong_password')

Invoke-RestMethod -Uri "$base/me/password" -Method Post -ContentType 'application/json' -Headers @{ Authorization = "Bearer $access3" } -Body (@{ currentPassword = 'correct-horse-battery'; newPassword = 'new-staple-battery9' } | ConvertTo-Json) | Out-Null
Check '改密成功' $true

# 新密码登录（handle 大小写不敏感）
$login2 = Invoke-RestMethod -Uri "$base/auth/login" -Method Post -ContentType 'application/json' -Body (@{ identifier = $handle.ToUpper(); password = 'new-staple-battery9' } | ConvertTo-Json)
Check 'handle 大小写不敏感登录 + 新密码' ($login2.accessToken)

# ── 9. 登出 ──
Invoke-RestMethod -Uri "$base/auth/logout" -Method Post -ContentType 'application/json' -Headers @{ Authorization = "Bearer $($login2.accessToken)" } -Body '{}' | Out-Null
$code = 0
try { Invoke-RestMethod -Uri "$base/auth/refresh" -Method Post -ContentType 'application/json' -Body (@{ refreshToken = $login2.refreshToken } | ConvertTo-Json) | Out-Null }
catch { $code = [int]$_.Exception.Response.StatusCode }
Check '登出后刷新令牌失效' ($code -eq 401)

# ── 10. 请求体校验错误走统一信封 ──
$code = 0
try {
    Invoke-RestMethod -Uri "$base/auth/register" -Method Post -ContentType 'application/json' -Body (@{ handle = 'ab'; email = 'not-an-email'; password = 'short'; displayName = '' } | ConvertTo-Json) | Out-Null
} catch { $code = [int]$_.Exception.Response.StatusCode; $valBody = $_.ErrorDetails.Message }
Check '校验失败 422' ($code -eq 422)
Check '校验错误信封带 details' ($valBody -match '"details"' -and $valBody -match 'validation_failed')

# ── 11. 限流：连续 12 次登录（未命中用户）──
$hit429 = $false
for ($i = 0; $i -lt 12; $i++) {
    try {
        Invoke-RestMethod -Uri "$base/auth/login" -Method Post -ContentType 'application/json' -Body (@{ identifier = "nobody$i"; password = 'whatever-pass' } | ConvertTo-Json) | Out-Null
    } catch {
        if ([int]$_.Exception.Response.StatusCode -eq 429) { $hit429 = $true; $rlBody = $_.ErrorDetails.Message }
    }
}
Check '登录限流 429' $hit429
Check '限流错误信封' ($rlBody -match 'rate_limited')

Write-Host ''
if ($fail -eq 0) { Write-Host 'ALL PASS' -ForegroundColor Green } else { Write-Host 'HAS FAILURES' -ForegroundColor Red; exit 1 }
