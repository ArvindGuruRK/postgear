<#
.SYNOPSIS
  Publishes one real test post to a connected channel through the PostGear API.

.DESCRIPTION
  The composer cannot publish yet (Sprint 5), but the API's test-post endpoint
  can. This logs in as the seeded demo user, finds your channel by name, and
  posts to it.

  THIS POSTS PUBLICLY to the connected account.

.EXAMPLE
  .\scripts\publish-test-post.ps1 -ListOnly
  .\scripts\publish-test-post.ps1 -ChannelName "Arvind RK" -Message "Hello from PostGear"
  .\scripts\publish-test-post.ps1 -ChannelName "Arvind RK" -Message "With a picture" -WithLatestImage
#>
param(
  [string]$ChannelName,
  [string]$Message = "Hello from PostGear, testing locally",
  [switch]$WithLatestImage,
  [switch]$ListOnly,
  [string]$Base = "http://localhost:3001",
  [string]$Org = "seed-demo-org"
)

$ErrorActionPreference = "Stop"
$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$json = "application/json"

Invoke-RestMethod "$Base/auth/login" -Method Post -WebSession $session -ContentType $json `
  -Body '{"email":"demo@postgear.local","password":"DemoPassword123!"}' | Out-Null
Invoke-RestMethod "$Base/orgs/$Org/switch" -Method Post -WebSession $session | Out-Null

$channels = (Invoke-RestMethod "$Base/channels" -WebSession $session).channels

if ($ListOnly -or -not $ChannelName) {
  Write-Host "Channels in $Org (the seeded 'Acme ...' ones are fake):"
  $channels | ForEach-Object { Write-Host ("  {0}  ({1})  id={2}" -f $_.name, $_.providerIdentifier, $_.id) }
  if (-not $ListOnly) { Write-Host "`nRe-run with -ChannelName `"<name from the list>`"." }
  return
}

$channel = $channels | Where-Object { $_.name -eq $ChannelName } | Select-Object -First 1
if (-not $channel) { throw "No channel named '$ChannelName'. Run with -ListOnly to see the names." }

$body = @{ message = $Message }

if ($WithLatestImage) {
  $library = Invoke-RestMethod "$Base/media" -WebSession $session
  $image = $library.media | Where-Object { $_.type -eq "image" } | Select-Object -First 1
  if (-not $image) { throw "No image in the media library. Upload one at /$Org/media first." }
  Write-Host "Attaching: $($image.name)"
  $body.media = @(@{ type = "image"; path = $image.url })
}

Write-Host "Posting to $($channel.name) ($($channel.providerIdentifier))..."
$result = Invoke-RestMethod "$Base/channels/$($channel.id)/test-post" -Method Post `
  -WebSession $session -ContentType $json -Body ($body | ConvertTo-Json -Depth 5)

$result | ConvertTo-Json -Depth 5
