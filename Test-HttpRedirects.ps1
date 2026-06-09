param(
    $url = "https://david.gardiner.net.au"
)

$uri = [Uri]$url

(@(
"$url",
"$url/",
"$url/2025/07/azure-pipeline-template-expression.html",
"$url/2025/07/azure-pipeline-template-expression/",
"$url/2025/07/azure-pipeline-template-expression",
"$url/index.html",
"$url/speaking",
"$url/2025",
"$url/archive",
"$url/tags",
"$url/tags/",
"$url/tags/Azure"
) | ./Get-HttpTrace.ps1) > httptraces.txt

# Replace $uri.Host with 'testsite'
(Get-Content httptraces.txt) -replace [regex]::Escape($uri.Host), 'testsite' | Out-File httptraces-scrubbed.txt -Encoding utf8

