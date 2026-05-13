[CmdletBinding()]
param(
	[Parameter(Mandatory = $true, Position = 0, ValueFromPipeline = $true)]
	[string[]]$Url,

	[int]$MaxRedirects = 20,

	[int]$TimeoutSeconds = 30,

	[switch]$AllowInsecureTls
)

if ($MaxRedirects -lt 1) {
	Write-Error "MaxRedirects must be 1 or greater."
	exit 1
}

if ($TimeoutSeconds -lt 1) {
	Write-Error "TimeoutSeconds must be 1 or greater."
	exit 1
}

$allUrls = @()
if ($MyInvocation.ExpectingInput) {
	$allUrls = @($input)
}
elseif ($PSBoundParameters.ContainsKey('Url')) {
	$allUrls = @($Url)
}

$allUrls = $allUrls | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }

if ($allUrls.Count -eq 0) {
	Write-Error "No URL values were provided."
	exit 1
}

$handler = [System.Net.Http.HttpClientHandler]::new()
$handler.AllowAutoRedirect = $false
$handler.AutomaticDecompression = [System.Net.DecompressionMethods]::All

if ($AllowInsecureTls.IsPresent) {
	$handler.ServerCertificateCustomValidationCallback = { $true }
}

$client = [System.Net.Http.HttpClient]::new($handler)
$client.Timeout = [TimeSpan]::FromSeconds($TimeoutSeconds)

try {
	foreach ($singleUrl in $allUrls) {
		try {
			$currentUri = [Uri]::new($singleUrl)
		}
		catch {
			Write-Error "Invalid URL: $singleUrl"
			exit 1
		}

		$visited = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
		$redirectCount = 0

		Write-Output "Tracing URL: $currentUri"

		try {
			while ($true) {
				$visited.Add($currentUri.AbsoluteUri) | Out-Null

				$request = $null
				$response = $null

				try {
					$request = [System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::Head, $currentUri)
					$response = $client.Send($request)

					if ([int]$response.StatusCode -in @(405, 501)) {
						$response.Dispose()
						$request.Dispose()

						$request = [System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::Get, $currentUri)
						$response = $client.Send($request)
					}

					$statusCode = [int]$response.StatusCode
					$reason = $response.ReasonPhrase

					$isRedirect = $statusCode -ge 300 -and $statusCode -lt 400

					if (-not $isRedirect) {
						Write-Output "FINAL: $currentUri [$statusCode $reason]"
						break
					}

					$locationHeader = $response.Headers.Location
					if ($null -eq $locationHeader) {
						Write-Output "FINAL (no Location header): $currentUri [$statusCode $reason]"
						break
					}

					if ($locationHeader.IsAbsoluteUri) {
						$nextUri = $locationHeader
					}
					else {
						$nextUri = [Uri]::new($currentUri, $locationHeader)
					}

					$redirectCount++
					Write-Output "REDIRECT $redirectCount`: $currentUri -> $nextUri [$statusCode $reason]"

					if ($redirectCount -ge $MaxRedirects) {
						Write-Error "Reached MaxRedirects ($MaxRedirects) before resolving a final URL."
						exit 1
					}

					if ($visited.Contains($nextUri.AbsoluteUri)) {
						Write-Error "Redirect loop detected at: $nextUri"
						exit 1
					}

					$currentUri = $nextUri
				}
				finally {
					if ($null -ne $response) {
						$response.Dispose()
					}

					if ($null -ne $request) {
						$request.Dispose()
					}
				}
			}
		}
		catch {
			Write-Error "Request failed for '$currentUri': $($_.Exception.Message)"
			exit 1
		}
	}
}
finally {
	if ($null -ne $client) {
		$client.Dispose()
	}

	if ($null -ne $handler) {
		$handler.Dispose()
	}
}
