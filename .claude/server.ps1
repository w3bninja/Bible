param([int]$Port = 5500)

$root = Split-Path -Parent $PSScriptRoot
$tagsPath = Join-Path $root "data\tags.json"
$categoriesPath = Join-Path $root "data\categories.json"

$mimeMap = @{
  ".html" = "text/html"
  ".css"  = "text/css"
  ".js"   = "application/javascript"
  ".json" = "application/json"
  ".png"  = "image/png"
  ".jpg"  = "image/jpeg"
  ".jpeg" = "image/jpeg"
  ".svg"  = "image/svg+xml"
  ".ico"  = "image/x-icon"
}

if (-not (Test-Path $tagsPath)) {
  $emptyTags = '{"tags":[],"verseTags":{}}'
  [System.IO.File]::WriteAllText($tagsPath, $emptyTags, (New-Object System.Text.UTF8Encoding($false)))
}

if (-not (Test-Path $categoriesPath)) {
  $emptyCategories = '{"categories":[]}'
  [System.IO.File]::WriteAllText($categoriesPath, $emptyCategories, (New-Object System.Text.UTF8Encoding($false)))
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "Serving $root on http://localhost:$Port/"

while ($listener.IsListening) {
  $context = $listener.GetContext()
  $request = $context.Request
  $response = $context.Response
  $response.Headers.Add("Cache-Control", "no-store")
  try {
    $path = $request.Url.AbsolutePath

    if ($path -eq "/api/tags" -and $request.HttpMethod -eq "GET") {
      $bytes = [System.IO.File]::ReadAllBytes($tagsPath)
      $response.ContentType = "application/json"
      $response.OutputStream.Write($bytes, 0, $bytes.Length)
    }
    elseif ($path -eq "/api/tags" -and $request.HttpMethod -eq "POST") {
      $reader = New-Object System.IO.StreamReader($request.InputStream, $request.ContentEncoding)
      $body = $reader.ReadToEnd()
      $reader.Close()

      # Validate it is well-formed JSON before writing to disk.
      $null = $body | ConvertFrom-Json -ErrorAction Stop
      [System.IO.File]::WriteAllText($tagsPath, $body, (New-Object System.Text.UTF8Encoding($false)))

      $response.ContentType = "application/json"
      $okBytes = [System.Text.Encoding]::UTF8.GetBytes('{"ok":true}')
      $response.OutputStream.Write($okBytes, 0, $okBytes.Length)
    }
    elseif ($path -eq "/api/categories" -and $request.HttpMethod -eq "GET") {
      $bytes = [System.IO.File]::ReadAllBytes($categoriesPath)
      $response.ContentType = "application/json"
      $response.OutputStream.Write($bytes, 0, $bytes.Length)
    }
    elseif ($path -eq "/api/categories" -and $request.HttpMethod -eq "POST") {
      $reader = New-Object System.IO.StreamReader($request.InputStream, $request.ContentEncoding)
      $body = $reader.ReadToEnd()
      $reader.Close()

      $null = $body | ConvertFrom-Json -ErrorAction Stop
      [System.IO.File]::WriteAllText($categoriesPath, $body, (New-Object System.Text.UTF8Encoding($false)))

      $response.ContentType = "application/json"
      $okBytes = [System.Text.Encoding]::UTF8.GetBytes('{"ok":true}')
      $response.OutputStream.Write($okBytes, 0, $okBytes.Length)
    }
    else {
      if ($path -eq "/") { $path = "/index.html" }
      $filePath = Join-Path $root ($path.TrimStart("/"))

      if (Test-Path $filePath -PathType Leaf) {
        $ext = [System.IO.Path]::GetExtension($filePath)
        $contentType = $mimeMap[$ext]
        if (-not $contentType) { $contentType = "application/octet-stream" }
        $bytes = [System.IO.File]::ReadAllBytes($filePath)
        $response.ContentType = $contentType
        $response.ContentLength64 = $bytes.Length
        $response.OutputStream.Write($bytes, 0, $bytes.Length)
      } else {
        $response.StatusCode = 404
        $notFound = [System.Text.Encoding]::UTF8.GetBytes("Not found: $path")
        $response.OutputStream.Write($notFound, 0, $notFound.Length)
      }
    }
  } catch {
    $response.StatusCode = 500
    $errBytes = [System.Text.Encoding]::UTF8.GetBytes("Server error: $($_.Exception.Message)")
    $response.OutputStream.Write($errBytes, 0, $errBytes.Length)
  } finally {
    $response.OutputStream.Close()
  }
}
