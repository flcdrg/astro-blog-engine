# Generate a summary of the Lighthouse report
$json = Get-Content .lighthouseci/links.json | ConvertFrom-Json

$markDown = "## Lighthouse Report Summary`n`n"
$markDown += "| URL | Performance | Accessibility | Best Practices | SEO | PWA |`n"
$markDown += "| --- | :---: | :---: | :---: | :---: | :---: |`n"

foreach ($property in $json.PSObject.Properties) {
    $url = $property.Name
    $reportUrl = $property.Value
            
    # Find all related lhr files for this URL
    $lhrFiles = Get-ChildItem .lighthouseci/lhr-*.json | Where-Object { 
        $content = Get-Content $_ | ConvertFrom-Json
        $content.requestedUrl -eq $url -or $content.finalUrl -eq $url
    }
            
    # Get the latest file based on fetchTime
    $latestLhrFile = $lhrFiles | ForEach-Object {
        $content = Get-Content $_ | ConvertFrom-Json
        [PSCustomObject]@{
            File      = $_
            FetchTime = $content.fetchTime
        }
    } | Sort-Object -Property FetchTime -Descending | Select-Object -First 1
            
    if ($latestLhrFile) {
        $lhrContent = Get-Content $latestLhrFile.File | ConvertFrom-Json
              
        # Calculate scores - multiply by 100 and round to show as percentages
        $performance = [Math]::Round($lhrContent.categories.performance.score * 100)
        $accessibility = [Math]::Round($lhrContent.categories.accessibility.score * 100)
        $bestPractices = [Math]::Round($lhrContent.categories.'best-practices'.score * 100)
        $seo = [Math]::Round($lhrContent.categories.seo.score * 100)
        $pwa = if ($lhrContent.categories.pwa.score) { [Math]::Round($lhrContent.categories.pwa.score * 100) } else { "N/A" }
              
        # Add emoji indicators based on score
        $getEmoji = {
            param($score)
            if ($score -eq "N/A") { return "N/A" }
            if ($score -ge 90) { return "✅ $score%" }
            elseif ($score -ge 50) { return "⚠️ $score%" }
            else { return "❌ $score%" }
        }
              
        # Display scores with emojis
        $markDown += "| [$url]($reportUrl) | $(&$getEmoji $performance) | $(&$getEmoji $accessibility) | $(&$getEmoji $bestPractices) | $(&$getEmoji $seo) | $(&$getEmoji $pwa) |`n"
    }
    else {
        $markDown += "| [$url]($reportUrl) | No data | No data | No data | No data | No data |`n"
    }
}

$markDown