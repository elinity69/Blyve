# Test R2 presign flow on Windows PowerShell (curl.exe, not the curl alias).
# Usage:
#   $env:SUPABASE_URL = "https://YOUR_PROJECT.supabase.co"
#   $env:SUPABASE_ANON_KEY = "your_anon_jwt"
#   $env:ACCESS_TOKEN = "user_access_token_from_browser_localStorage"
#   $env:CONVERSATION_ID = "uuid-of-dm-conversation"
#   .\scripts\test-r2-upload.ps1

param(
  [string]$SupabaseUrl = $env:SUPABASE_URL,
  [string]$AnonKey = $env:SUPABASE_ANON_KEY,
  [string]$AccessToken = $env:ACCESS_TOKEN,
  [string]$ConversationId = $env:CONVERSATION_ID
)

if (-not $SupabaseUrl -or -not $AnonKey -or -not $AccessToken -or -not $ConversationId) {
  Write-Error "Set SUPABASE_URL, SUPABASE_ANON_KEY, ACCESS_TOKEN, CONVERSATION_ID (or pass params)."
  exit 1
}

$base = $SupabaseUrl.TrimEnd('/')
$presignUrl = "$base/functions/v1/blyve/uploads/presign"
$body = @{
  mime_type        = "image/png"
  size_bytes       = 12345
  conversation_id  = $ConversationId
} | ConvertTo-Json

Write-Host "POST presign -> $presignUrl"
$presign = curl.exe -s -X POST $presignUrl `
  -H "Authorization: Bearer $AccessToken" `
  -H "apikey: $AnonKey" `
  -H "Content-Type: application/json" `
  -d $body | ConvertFrom-Json

if (-not $presign.attachmentId) {
  Write-Error "Presign failed: $($presign | ConvertTo-Json -Compress)"
  exit 1
}

Write-Host "attachmentId: $($presign.attachmentId)"
Write-Host "uploadUrl: $($presign.uploadUrl)"
Write-Host ""
Write-Host "Next: PUT a real PNG to uploadUrl, then:"
Write-Host "curl.exe -s -X POST `"$base/functions/v1/blyve/uploads/confirm`" \"
Write-Host "  -H `"Authorization: Bearer $AccessToken`" \"
Write-Host "  -H `"apikey: $AnonKey`" \"
Write-Host "  -H `"Content-Type: application/json`" \"
Write-Host "  -d `"{\`"attachment_id\`":\`"$($presign.attachmentId)\`"}`""
