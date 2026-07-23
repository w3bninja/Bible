param(
  [string]$InDir = "$PSScriptRoot\source\usfm",
  [string]$OutPath = "$(Split-Path -Parent $PSScriptRoot)\data\bible.json"
)

# Maps USFM book codes (from the KJV Cambridge Paragraph Bible, ebible.org/engkjvcpb)
# to full names, order and testament.
$bookMeta = @(
  @{ code = "GEN"; name = "Genesis";         testament = "OT" }
  @{ code = "EXO"; name = "Exodus";          testament = "OT" }
  @{ code = "LEV"; name = "Leviticus";       testament = "OT" }
  @{ code = "NUM"; name = "Numbers";         testament = "OT" }
  @{ code = "DEU"; name = "Deuteronomy";     testament = "OT" }
  @{ code = "JOS"; name = "Joshua";          testament = "OT" }
  @{ code = "JDG"; name = "Judges";          testament = "OT" }
  @{ code = "RUT"; name = "Ruth";            testament = "OT" }
  @{ code = "1SA"; name = "1 Samuel";        testament = "OT" }
  @{ code = "2SA"; name = "2 Samuel";        testament = "OT" }
  @{ code = "1KI"; name = "1 Kings";         testament = "OT" }
  @{ code = "2KI"; name = "2 Kings";         testament = "OT" }
  @{ code = "1CH"; name = "1 Chronicles";    testament = "OT" }
  @{ code = "2CH"; name = "2 Chronicles";    testament = "OT" }
  @{ code = "EZR"; name = "Ezra";            testament = "OT" }
  @{ code = "NEH"; name = "Nehemiah";        testament = "OT" }
  @{ code = "EST"; name = "Esther";          testament = "OT" }
  @{ code = "JOB"; name = "Job";             testament = "OT" }
  @{ code = "PSA"; name = "Psalms";          testament = "OT" }
  @{ code = "PRO"; name = "Proverbs";        testament = "OT" }
  @{ code = "ECC"; name = "Ecclesiastes";    testament = "OT" }
  @{ code = "SNG"; name = "Song of Solomon"; testament = "OT" }
  @{ code = "ISA"; name = "Isaiah";          testament = "OT" }
  @{ code = "JER"; name = "Jeremiah";        testament = "OT" }
  @{ code = "LAM"; name = "Lamentations";    testament = "OT" }
  @{ code = "EZK"; name = "Ezekiel";         testament = "OT" }
  @{ code = "DAN"; name = "Daniel";          testament = "OT" }
  @{ code = "HOS"; name = "Hosea";           testament = "OT" }
  @{ code = "JOL"; name = "Joel";            testament = "OT" }
  @{ code = "AMO"; name = "Amos";            testament = "OT" }
  @{ code = "OBA"; name = "Obadiah";         testament = "OT" }
  @{ code = "JON"; name = "Jonah";           testament = "OT" }
  @{ code = "MIC"; name = "Micah";           testament = "OT" }
  @{ code = "NAM"; name = "Nahum";           testament = "OT" }
  @{ code = "HAB"; name = "Habakkuk";        testament = "OT" }
  @{ code = "ZEP"; name = "Zephaniah";       testament = "OT" }
  @{ code = "HAG"; name = "Haggai";          testament = "OT" }
  @{ code = "ZEC"; name = "Zechariah";       testament = "OT" }
  @{ code = "MAL"; name = "Malachi";         testament = "OT" }
  @{ code = "MAT"; name = "Matthew";         testament = "NT" }
  @{ code = "MRK"; name = "Mark";            testament = "NT" }
  @{ code = "LUK"; name = "Luke";            testament = "NT" }
  @{ code = "JHN"; name = "John";            testament = "NT" }
  @{ code = "ACT"; name = "Acts";            testament = "NT" }
  @{ code = "ROM"; name = "Romans";          testament = "NT" }
  @{ code = "1CO"; name = "1 Corinthians";   testament = "NT" }
  @{ code = "2CO"; name = "2 Corinthians";   testament = "NT" }
  @{ code = "GAL"; name = "Galatians";       testament = "NT" }
  @{ code = "EPH"; name = "Ephesians";       testament = "NT" }
  @{ code = "PHP"; name = "Philippians";     testament = "NT" }
  @{ code = "COL"; name = "Colossians";      testament = "NT" }
  @{ code = "1TH"; name = "1 Thessalonians"; testament = "NT" }
  @{ code = "2TH"; name = "2 Thessalonians"; testament = "NT" }
  @{ code = "1TI"; name = "1 Timothy";       testament = "NT" }
  @{ code = "2TI"; name = "2 Timothy";       testament = "NT" }
  @{ code = "TIT"; name = "Titus";           testament = "NT" }
  @{ code = "PHM"; name = "Philemon";        testament = "NT" }
  @{ code = "HEB"; name = "Hebrews";         testament = "NT" }
  @{ code = "JAS"; name = "James";           testament = "NT" }
  @{ code = "1PE"; name = "1 Peter";         testament = "NT" }
  @{ code = "2PE"; name = "2 Peter";         testament = "NT" }
  @{ code = "1JN"; name = "1 John";          testament = "NT" }
  @{ code = "2JN"; name = "2 John";          testament = "NT" }
  @{ code = "3JN"; name = "3 John";          testament = "NT" }
  @{ code = "JUD"; name = "Jude";            testament = "NT" }
  @{ code = "REV"; name = "Revelation";      testament = "NT" }
)

function Clean-Text([string]$text) {
  if (-not $text) { return "" }
  # Strip footnotes, cross-references, and alternate/published verse-number spans entirely (with their content).
  $text = [regex]::Replace($text, '\\f\s.*?\\f\*', '')
  $text = [regex]::Replace($text, '\\x\s.*?\\x\*', '')
  $text = [regex]::Replace($text, '\\va\s.*?\\va\*', '')
  $text = [regex]::Replace($text, '\\vp\s.*?\\vp\*', '')
  # Strip inline formatting marker pairs but keep their inner text (added words, small caps, italics, etc).
  # Opening markers consume the single mandatory separator space after the tag name;
  # closing markers (\add*) must NOT consume a following space - that space is real content.
  $text = [regex]::Replace($text, '\\(add|sc|it|bd|em|wj|nd|tl|k)\s', '')
  $text = [regex]::Replace($text, '\\(add|sc|it|bd|em|wj|nd|tl|k)\*', '')
  $text = [regex]::Replace($text, '\s+', ' ')
  return $text.Trim()
}

function Convert-Book($lines) {
  $chapters = New-Object System.Collections.Generic.List[object]
  $chapterNum = 0
  $chapterLines = $null
  $heading = $null
  $paragraphPending = $false
  $poeticPending = $false
  $poeticLevel = 1
  $lastVerseNum = 0

  function Flush-Chapter {
    if ($chapterNum -gt 0) {
      $verseMap = [ordered]@{}
      foreach ($ln in $chapterLines) {
        $k = [string]$ln.verse
        if ($verseMap.Contains($k)) { $verseMap[$k] = "$($verseMap[$k]) $($ln.text)".Trim() }
        else { $verseMap[$k] = $ln.text }
      }
      $maxVerse = ($chapterLines | ForEach-Object { $_.verse } | Measure-Object -Maximum).Maximum
      $versesArr = @()
      for ($i = 1; $i -le $maxVerse; $i++) { $versesArr += $verseMap[[string]$i] }

      $script:allChapters += , [PSCustomObject]@{
        heading = $script:heading
        verses  = $versesArr
        lines   = $chapterLines
      }
    }
  }

  $script:allChapters = @()
  $script:heading = $null

  foreach ($raw in $lines) {
    $line = $raw.TrimEnd()
    if ($line -match '^\\c\s+(\d+)') {
      Flush-Chapter
      $chapterNum = [int]$Matches[1]
      $chapterLines = New-Object System.Collections.Generic.List[object]
      $script:heading = $null
      $paragraphPending = $false
      $poeticPending = $false
      continue
    }
    if ($chapterNum -eq 0) { continue }

    if ($line -match '^\\(d|ms1)\b\s*(.*)') {
      $t = Clean-Text $Matches[2]
      if ($t) {
        if ($script:heading) { $script:heading = "$($script:heading) $t" } else { $script:heading = $t }
      }
      continue
    }
    if ($line -match '^\\(p|m|mi|nb|b)\b\s*(.*)') {
      $paragraphPending = $true
      $poeticPending = $false
      continue
    }
    if ($line -match '^\\(q1|q2|q3|qc)\b\s*(.*)') {
      $poeticLevel = if ($Matches[1] -eq 'q2') { 2 } elseif ($Matches[1] -eq 'q3') { 3 } else { 1 }
      $poeticPending = $true
      $rest = $Matches[2]
      if ($rest -and $rest.Trim()) {
        $cleaned = Clean-Text $rest
        if ($cleaned) {
          $chapterLines.Add([PSCustomObject]@{
            verse = $lastVerseNum; text = $cleaned; newPara = $paragraphPending; poetic = $true; indent = $poeticLevel
          })
        }
        $paragraphPending = $false
        $poeticPending = $false
      }
      continue
    }
    if ($line -match '^\\v\s+(\d+)\s*(.*)') {
      $vnum = [int]$Matches[1]
      $lastVerseNum = $vnum
      $cleaned = Clean-Text $Matches[2]
      $chapterLines.Add([PSCustomObject]@{
        verse = $vnum; text = $cleaned; newPara = $paragraphPending; poetic = $poeticPending; indent = $poeticLevel
      })
      $paragraphPending = $false
      $poeticPending = $false
      continue
    }
    # Any other marker (\id, \h, \toc*, \mt*, \ip, \cp, etc.) is ignored.
  }
  Flush-Chapter
  return $script:allChapters
}

$books = @()
$order = 0
foreach ($meta in $bookMeta) {
  $file = Get-ChildItem -Path $InDir -Filter "*-$($meta.code)engkjvcpb.usfm" | Select-Object -First 1
  if (-not $file) {
    Write-Warning "No USFM file found for $($meta.code) - skipping"
    continue
  }
  $order++
  $id = ($meta.name -replace '[^a-zA-Z0-9]', '').ToLower()
  # Get-Content -Encoding UTF8 misreads these no-BOM UTF-8 files as the system
  # codepage in Windows PowerShell 5.1, mangling curly quotes; read raw bytes instead.
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  $lines = [System.IO.File]::ReadAllLines($file.FullName, $utf8NoBom)

  $chapters = Convert-Book $lines

  $books += [PSCustomObject]@{
    id        = $id
    name      = $meta.name
    testament = $meta.testament
    order     = $order
    chapters  = $chapters
  }
  Write-Host "Converted $($meta.name): $($chapters.Count) chapters"
}

$bible = [PSCustomObject]@{ books = $books }
$json = $bible | ConvertTo-Json -Depth 10 -Compress
[System.IO.File]::WriteAllText($OutPath, $json, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "Wrote bible data to $OutPath"
