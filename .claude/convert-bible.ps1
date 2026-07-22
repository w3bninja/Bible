param(
  [string]$InPath = "$PSScriptRoot\source\kjv_raw.json",
  [string]$OutPath = "$(Split-Path -Parent $PSScriptRoot)\data\bible.json"
)

# Maps the thiagobodruk/bible abbreviations to full names, order and testament.
$bookMeta = @(
  @{ abbrev = "gn";  name = "Genesis";         testament = "OT" }
  @{ abbrev = "ex";  name = "Exodus";          testament = "OT" }
  @{ abbrev = "lv";  name = "Leviticus";       testament = "OT" }
  @{ abbrev = "nm";  name = "Numbers";         testament = "OT" }
  @{ abbrev = "dt";  name = "Deuteronomy";     testament = "OT" }
  @{ abbrev = "js";  name = "Joshua";          testament = "OT" }
  @{ abbrev = "jud"; name = "Judges";          testament = "OT" }
  @{ abbrev = "rt";  name = "Ruth";            testament = "OT" }
  @{ abbrev = "1sm"; name = "1 Samuel";        testament = "OT" }
  @{ abbrev = "2sm"; name = "2 Samuel";        testament = "OT" }
  @{ abbrev = "1kgs";name = "1 Kings";         testament = "OT" }
  @{ abbrev = "2kgs";name = "2 Kings";         testament = "OT" }
  @{ abbrev = "1ch"; name = "1 Chronicles";    testament = "OT" }
  @{ abbrev = "2ch"; name = "2 Chronicles";    testament = "OT" }
  @{ abbrev = "ezr"; name = "Ezra";            testament = "OT" }
  @{ abbrev = "ne";  name = "Nehemiah";        testament = "OT" }
  @{ abbrev = "et";  name = "Esther";          testament = "OT" }
  @{ abbrev = "job"; name = "Job";             testament = "OT" }
  @{ abbrev = "ps";  name = "Psalms";          testament = "OT" }
  @{ abbrev = "prv"; name = "Proverbs";        testament = "OT" }
  @{ abbrev = "ec";  name = "Ecclesiastes";    testament = "OT" }
  @{ abbrev = "so";  name = "Song of Solomon"; testament = "OT" }
  @{ abbrev = "is";  name = "Isaiah";          testament = "OT" }
  @{ abbrev = "jr";  name = "Jeremiah";        testament = "OT" }
  @{ abbrev = "lm";  name = "Lamentations";    testament = "OT" }
  @{ abbrev = "ez";  name = "Ezekiel";         testament = "OT" }
  @{ abbrev = "dn";  name = "Daniel";          testament = "OT" }
  @{ abbrev = "ho";  name = "Hosea";           testament = "OT" }
  @{ abbrev = "jl";  name = "Joel";            testament = "OT" }
  @{ abbrev = "am";  name = "Amos";            testament = "OT" }
  @{ abbrev = "ob";  name = "Obadiah";         testament = "OT" }
  @{ abbrev = "jn";  name = "Jonah";           testament = "OT" }
  @{ abbrev = "mi";  name = "Micah";           testament = "OT" }
  @{ abbrev = "na";  name = "Nahum";           testament = "OT" }
  @{ abbrev = "hk";  name = "Habakkuk";        testament = "OT" }
  @{ abbrev = "zp";  name = "Zephaniah";       testament = "OT" }
  @{ abbrev = "hg";  name = "Haggai";          testament = "OT" }
  @{ abbrev = "zc";  name = "Zechariah";       testament = "OT" }
  @{ abbrev = "ml";  name = "Malachi";         testament = "OT" }
  @{ abbrev = "mt";  name = "Matthew";         testament = "NT" }
  @{ abbrev = "mk";  name = "Mark";            testament = "NT" }
  @{ abbrev = "lk";  name = "Luke";            testament = "NT" }
  @{ abbrev = "jo";  name = "John";            testament = "NT" }
  @{ abbrev = "act"; name = "Acts";            testament = "NT" }
  @{ abbrev = "rm";  name = "Romans";          testament = "NT" }
  @{ abbrev = "1co"; name = "1 Corinthians";   testament = "NT" }
  @{ abbrev = "2co"; name = "2 Corinthians";   testament = "NT" }
  @{ abbrev = "gl";  name = "Galatians";       testament = "NT" }
  @{ abbrev = "eph"; name = "Ephesians";       testament = "NT" }
  @{ abbrev = "ph";  name = "Philippians";     testament = "NT" }
  @{ abbrev = "cl";  name = "Colossians";      testament = "NT" }
  @{ abbrev = "1ts"; name = "1 Thessalonians"; testament = "NT" }
  @{ abbrev = "2ts"; name = "2 Thessalonians"; testament = "NT" }
  @{ abbrev = "1tm"; name = "1 Timothy";       testament = "NT" }
  @{ abbrev = "2tm"; name = "2 Timothy";       testament = "NT" }
  @{ abbrev = "tt";  name = "Titus";           testament = "NT" }
  @{ abbrev = "phm"; name = "Philemon";        testament = "NT" }
  @{ abbrev = "hb";  name = "Hebrews";         testament = "NT" }
  @{ abbrev = "jm";  name = "James";           testament = "NT" }
  @{ abbrev = "1pe"; name = "1 Peter";         testament = "NT" }
  @{ abbrev = "2pe"; name = "2 Peter";         testament = "NT" }
  @{ abbrev = "1jo"; name = "1 John";          testament = "NT" }
  @{ abbrev = "2jo"; name = "2 John";          testament = "NT" }
  @{ abbrev = "3jo"; name = "3 John";          testament = "NT" }
  @{ abbrev = "jd";  name = "Jude";            testament = "NT" }
  @{ abbrev = "re";  name = "Revelation";      testament = "NT" }
)

$metaByAbbrev = @{}
foreach ($m in $bookMeta) { $metaByAbbrev[$m.abbrev] = $m }

$source = Get-Content $InPath -Raw -Encoding UTF8 | ConvertFrom-Json

$books = @()
$order = 0
foreach ($sourceBook in $source) {
  $meta = $metaByAbbrev[$sourceBook.abbrev]
  if (-not $meta) {
    Write-Warning "No name mapping for abbrev '$($sourceBook.abbrev)' - skipping"
    continue
  }
  $order++
  $id = ($meta.name -replace '[^a-zA-Z0-9]', '').ToLower()

  $chapters = @()
  foreach ($chapterVerses in $sourceBook.chapters) {
    $chapters += , @($chapterVerses)
  }

  $books += [PSCustomObject]@{
    id        = $id
    name      = $meta.name
    testament = $meta.testament
    order     = $order
    chapters  = $chapters
  }
}

Write-Host "Converted $($books.Count) books"
$bible = [PSCustomObject]@{ books = $books }
$json = $bible | ConvertTo-Json -Depth 8 -Compress
[System.IO.File]::WriteAllText($OutPath, $json, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "Wrote bible data to $OutPath"
