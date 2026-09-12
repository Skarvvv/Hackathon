# 乡居设计通 · 本地一键演示代理（PowerShell 5.1+，零安装、免管理员）
# 用 TcpListener 直接实现 HTTP/1.1，绕开 HttpListener 的 urlacl 权限问题；
# 与 local_proxy.py 同协议、同端口 8788，并在同端口托管演示网页（同源无跨域）。
#
# 启动：powershell -NoProfile -ExecutionPolicy Bypass -File local_proxy.ps1
# 可选参数：-Port 8790；可选环境变量：APP_TOKEN、UPSTREAM_URL、FORCE_MODEL
param(
  [int]$Port        = $(if ($env:PORT) { [int]$env:PORT } else { 8788 }),
  [string]$Upstream = $(if ($env:UPSTREAM_URL) { $env:UPSTREAM_URL.TrimEnd('/') } else { 'https://api.deepseek.com' }),
  [string]$ForceModel = $(if ($null -ne $env:FORCE_MODEL) { $env:FORCE_MODEL } else { 'deepseek-chat' })
)

$ErrorActionPreference = 'Stop'
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$logFile = Join-Path $scriptRoot 'local_proxy.log'
try { $Host.UI.RawUI.WindowTitle = '乡居设计通 · 本地演示代理（关闭此窗口即停止）' } catch {}

function Log([string]$msg) {
  $line = ('{0} {1}' -f (Get-Date -Format 'HH:mm:ss'), $msg)
  Write-Host $line
  try { Add-Content -Path $logFile -Value $line -Encoding UTF8 } catch {}
}

try {
  # ---------- 1. 取密钥：优先环境变量；否则交互输入（SecureString 不回显） ----------
  $apiKey = $env:DEEPSEEK_API_KEY
  if (-not $apiKey) {
    Write-Host ''
    Write-Host '乡居设计通 · 本地一键演示代理' -ForegroundColor Yellow
    Write-Host 'Key 只保存在本窗口进程内，不写盘、不经过任何第三方。' -ForegroundColor DarkGray
    Write-Host ''
    $sec = Read-Host '请粘贴 DeepSeek API Key（sk- 开头，输入不显示），回车确认'
    if ($sec) {
      $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
      try { $apiKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
      finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
    }
  }
  if (-not $apiKey) { throw '没有输入 API Key' }
  $appToken = $env:APP_TOKEN
  if ($appToken) { Log '已启用访问口令 APP_TOKEN。' }

  # ---------- 2. 静态文件白名单（同目录），杜绝路径穿越 ----------
  $staticFiles = @{
    '/'           = @('index.html', 'text/html; charset=utf-8')
    '/index.html' = @('index.html', 'text/html; charset=utf-8')
    '/styles.css' = @('styles.css', 'text/css; charset=utf-8')
    '/data.js'    = @('data.js', 'application/javascript; charset=utf-8')
    '/llm.js'     = @('llm.js', 'application/javascript; charset=utf-8')
    '/app.js'     = @('app.js', 'application/javascript; charset=utf-8')
  }
  $maxBody = 96 * 1024
  $cors = @{
    'Access-Control-Allow-Origin'  = '*'
    'Access-Control-Allow-Methods' = 'POST, GET, OPTIONS'
    'Access-Control-Allow-Headers' = 'Content-Type, Authorization, X-App-Token'
    'Access-Control-Max-Age'       = '86400'
  }

  Add-Type -AssemblyName System.Net.Http
  $client = New-Object System.Net.Http.HttpClient
  $client.Timeout = [TimeSpan]::FromSeconds(60)

  # ---------- 3. TcpListener（127.0.0.1 高端口，非管理员可监听） ----------
  $listener = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Parse('127.0.0.1'), $Port)
  $listener.Start()
  Log ('代理已启动: http://127.0.0.1:{0}/ （接口 /v1/chat/completions，健康检查 /healthz，上游 {1}）' -f $Port, $Upstream)
  Log '保持本窗口开着即可演示；关闭窗口即停止。'

  function Send-Raw($stream, [int]$code, [byte[]]$body, [string]$ctype, [bool]$close) {
    $reason = @{ 200='OK'; 204='No Content'; 400='Bad Request'; 401='Unauthorized'; 404='Not Found';
                 413='Payload Too Large'; 500='Internal Server Error'; 502='Bad Gateway' }[[int]$code]
    if (-not $reason) { $reason = 'OK' }
    $head = "HTTP/1.1 $code $reason`r`n"
    $head += "Content-Type: $ctype`r`n"
    if ($code -eq 204) { $head += "Content-Length: 0`r`n" }
    else { $head += "Content-Length: $($body.Length)`r`n" }
    foreach ($k in $cors.Keys) { $head += "$k`: $($cors[$k])`r`n" }
    $head += "Connection: close`r`nCache-Control: no-cache`r`n`r`n"
    $hb = [Text.Encoding]::ASCII.GetBytes($head)
    $stream.Write($hb, 0, $hb.Length)
    if ($code -ne 204 -and $body.Length -gt 0) { $stream.Write($body, 0, $body.Length) }
    $stream.Flush()
  }
  function Send-Json($stream, [int]$code, $obj) {
    $json = $obj | ConvertTo-Json -Compress -Depth 6
    Send-Raw $stream $code ([Text.Encoding]::UTF8.GetBytes($json)) 'application/json; charset=utf-8' $true
  }

  # ---------- 4. 主循环（演示流量小，同步处理足够） ----------
  while ($true) {
    $tcp = $null; $stream = $null
    try {
      $tcp = $listener.AcceptTcpClient()
      $tcp.NoDelay = $true
      $stream = $tcp.GetStream()
      $stream.ReadTimeout = 30000

      # 读到请求头结束符
      $ms = New-Object IO.MemoryStream
      $buf = New-Object byte[] 8192
      $headerEnd = -1
      while ($headerEnd -lt 0) {
        $n = $stream.Read($buf, 0, $buf.Length)
        if ($n -le 0) { break }
        $ms.Write($buf, 0, $n)
        $all = $ms.ToArray()
        for ($i = 0; $i -le $all.Length - 4; $i++) {
          if ($all[$i] -eq 13 -and $all[$i+1] -eq 10 -and $all[$i+2] -eq 13 -and $all[$i+3] -eq 10) { $headerEnd = $i + 4; break }
        }
        if ($ms.Length -gt 65536) { break }
      }
      $raw = $ms.ToArray()
      if ($headerEnd -lt 0) { try { Send-Json $stream 400 ([pscustomobject]@{error=[pscustomobject]@{message='请求头过大或不完整'}}) } catch {}; $tcp.Close(); continue }

      $headerText = [Text.Encoding]::ASCII.GetString($raw, 0, $headerEnd)
      $lines = $headerText -split "`r`n"
      $parts = $lines[0] -split ' '
      $method = $parts[0]; $path = ($parts[1] -split '\?')[0]
      $headers = @{}
      for ($i = 1; $i -lt $lines.Count; $i++) {
        $line = $lines[$i]
        $idx = $line.IndexOf(':')
        if ($idx -gt 0) { $headers[$line.Substring(0, $idx).Trim().ToLower()] = $line.Substring($idx + 1).Trim() }
      }
      $contentLength = 0
      [void][int]::TryParse($headers['content-length'], [ref]$contentLength)
      if ($contentLength -gt $maxBody) {
        Send-Json $stream 413 ([pscustomobject]@{error=[pscustomobject]@{message='请求体超过 96KB 限制'}})
        $tcp.Close(); continue
      }
      $bodyMs = New-Object IO.MemoryStream
      $already = $raw.Length - $headerEnd
      if ($already -gt 0) { $bodyMs.Write($raw, $headerEnd, [Math]::Min($already, $contentLength)) }
      while ($bodyMs.Length -lt $contentLength) {
        $want = [Math]::Min($buf.Length, $contentLength - $bodyMs.Length)
        $n = $stream.Read($buf, 0, $want)
        if ($n -le 0) { break }
        $bodyMs.Write($buf, 0, $n)
      }
      $bodyBytes = $bodyMs.ToArray()

      if ($method -eq 'OPTIONS') { Send-Raw $stream 204 ([byte[]]@()) 'text/plain' $true; $tcp.Close(); continue }

      if ($method -eq 'GET' -and $path -eq '/healthz') {
        Log 'GET /healthz'
        Send-Json $stream 200 ([pscustomobject]@{
          ok=$true; service='xiangju-local-proxy-ps'; keyConfigured=($apiKey.Length -gt 8);
          tokenRequired=[bool]$appToken; forceModel=$ForceModel })
        $tcp.Close(); continue
      }

      if ($method -eq 'POST' -and ($path -eq '/v1/chat/completions' -or $path -eq '/chat/completions')) {
        if ($appToken -and $headers['x-app-token'] -ne $appToken) {
          Send-Json $stream 401 ([pscustomobject]@{error=[pscustomobject]@{message='代理访问口令不对（X-App-Token）'}})
          $tcp.Close(); continue
        }
        $bodyObj = $null
        try { $bodyObj = [Text.Encoding]::UTF8.GetString($bodyBytes) | ConvertFrom-Json }
        catch { Send-Json $stream 400 ([pscustomobject]@{error=[pscustomobject]@{message='请求体不是合法 JSON'}}); $tcp.Close(); continue }
        if ($ForceModel) { $bodyObj | Add-Member -NotePropertyName model -NotePropertyValue $ForceModel -Force }
        elseif (-not $bodyObj.model) { $bodyObj | Add-Member -NotePropertyName model -NotePropertyValue 'deepseek-chat' }
        $outJson = $bodyObj | ConvertTo-Json -Depth 20 -Compress
        $content = New-Object System.Net.Http.StringContent($outJson, [Text.Encoding]::UTF8, 'application/json')
        $reqMsg = New-Object System.Net.Http.HttpRequestMessage([System.Net.Http.HttpMethod]::Post, "$Upstream/chat/completions")
        $reqMsg.Content = $content
        $reqMsg.Headers.Authorization = New-Object System.Net.Http.Headers.AuthenticationHeaderValue('Bearer', $apiKey)
        try {
          $up = $client.SendAsync($reqMsg).Result
          $upBytes = $up.Content.ReadAsByteArrayAsync().Result
          $upType = if ($up.Content.Headers.ContentType) { $up.Content.Headers.ContentType.ToString() } else { 'application/json; charset=utf-8' }
          Log ("POST $path -> 上游 {0}" -f [int]$up.StatusCode)
          Send-Raw $stream ([int]$up.StatusCode) $upBytes $upType $true
        } catch {
          Log ('上游请求失败: ' + $_.Exception.Message)
          Send-Json $stream 502 ([pscustomobject]@{error=[pscustomobject]@{message='代理请求上游失败：' + $_.Exception.Message}})
        }
        $tcp.Close(); continue
      }

      # 其余一律按静态页面处理
      if ($method -eq 'GET' -and $staticFiles.ContainsKey($path)) {
        $info = $staticFiles[$path]
        $full = Join-Path $scriptRoot $info[0]
        if (Test-Path $full) {
          $bytes = [IO.File]::ReadAllBytes($full)
          Send-Raw $stream 200 $bytes $info[1] $true
          Log ("GET $path 200 {0}B" -f $bytes.Length)
        } else { Send-Raw $stream 404 ([Text.Encoding]::UTF8.GetBytes('file missing')) 'text/plain; charset=utf-8' $true }
      } else {
        Send-Json $stream 404 ([pscustomobject]@{error=[pscustomobject]@{message='只接受 POST /v1/chat/completions'}})
      }
      $tcp.Close()
    } catch {
      Log ('请求处理异常: ' + $_.Exception.Message)
      try { if ($stream) { Send-Json $stream 502 ([pscustomobject]@{error=[pscustomobject]@{message='代理异常：' + $_.Exception.Message}}) } } catch {}
      try { if ($tcp) { $tcp.Close() } } catch {}
    }
  }
} catch {
  # 致命错误：写日志并暂停，避免窗口一闪而过
  $fatal = '启动失败: ' + $_.Exception.Message
  try { Add-Content -Path $logFile -Value ((Get-Date -Format 'HH:mm:ss') + ' ' + $fatal) -Encoding UTF8 } catch {}
  Write-Host ''
  Write-Host $fatal -ForegroundColor Red
  Write-Host "详细日志：$logFile" -ForegroundColor Yellow
  Write-Host '若是端口占用，可换端口：powershell -ExecutionPolicy Bypass -File local_proxy.ps1 -Port 8790' -ForegroundColor Yellow
  Write-Host ''
  Read-Host '按回车键退出'
  exit 1
}
