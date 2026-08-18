# Edge Function Response Audit Script
# Tests every listed Edge Function (across both QueryCrest Supabase projects)
# with a plain GET request and records the exact response (or error) into
# edge_function_audit.txt

$outputFile = Join-Path (Get-Location) "edge_function_audit.txt"

# ---- Project A: icvegtgayxjqtwpyhqpm (main application backend) ----
$baseUrlA = "https://icvegtgayxjqtwpyhqpm.supabase.co/functions/v1"
$functionNamesA = @(
  "add-bursary",
  "addNextOfKin",
  "addOrUpdateAddress",
  "addUserAddress",
  "admin-chat",
  "admin-router",
  "adminLogin",
  "affiliate",
  "assignReferralCode",
  "chatbot",
  "createNotification",
  "createSupportTicket",
  "createUserAccount",
  "deleteDocument",
  "deleteNextOfKin",
  "deleteUserAccount",
  "display-student-results",
  "email-automation-worker",
  "extended-personal-Info",
  "fetch_messages",
  "fetch_sessions",
  "forgotPassword",
  "get_categories",
  "get_predefined_questions",
  "get-accommodations",
  "get-bursary-applications",
  "get-personal-info",
  "getAccountData",
  "getAccountHistory",
  "getAccountHistory",
  "getDashboardCounts",
  "getDashboardState",
  "getExtended-personal-Info",
  "getNextOfKin",
  "getNotifications",
  "GetPlans",
  "getUserAddress",
  "getUserDetails",
  "getUserDocuments",
  "getUserProfile",
  "googleAuth",
  "load-admissions-data",
  "load-Applications",
  "load-bursaries",
  "load-universities",
  "loginUser",
  "logout",
  "logout-User",
  "mark_read",
  "mark_read",
  "markNotificationRead",
  "no-application-reminder",
  "PayFast_WebHook",
  "PayFastITN",
  "personal-info",
  "ProcessPayment",
  "querycrest-cron-reminders",
  "querycrest-email-automation",
  "resetPassword",
  "resetPasswordWithToken",
  "reviews",
  "send_message",
  "sendEmailNotification",
  "sendNotification",
  "sendPushNotification",
  "state-check",
  "student-results",
  "submit-bursary-application",
  "submitApplication",
  "supportTickets",
  "system-modal",
  "track-applications",
  "university-autocomplete",
  "updateAdminDashboardSettings",
  "updateApplicationStatus",
  "updateNextOfKin",
  "updateTransactionStatus",
  "updateUserAddress",
  "updateUserPreferrence",
  "uploadDocument",
  "user-settings",
  "validate-promo-code",
  "verifyPayment",
  "verifyUser"
)

# ---- Project B: xkjsydeavdcarwkthppz (QueryCrest Database project) ----
$baseUrlB = "https://xkjsydeavdcarwkthppz.supabase.co/functions/v1"
$functionNamesB = @(
  "verify-user",
  "PayFast",
  "PayFast_WebHook",
  "auth",
  "admin-login",
  "admin-signup",
  "validate-admin",
  "list-universities",
  "add-university",
  "update-deadline",
  "getPage",
  "getMarquee",
  "subscribe",
  "getProspectuses",
  "apply-wil",
  "send-wil-confirmation",
  "get-news-posts",
  "fetch-interview-results",
  "terms-of-service"
)

# Combine both projects into a single ordered list of {Name, Url} pairs
$targets = @()
foreach ($name in $functionNamesA) {
  $targets += [PSCustomObject]@{ Name = $name; Url = "$baseUrlA/$name" }
}
foreach ($name in $functionNamesB) {
  $targets += [PSCustomObject]@{ Name = $name; Url = "$baseUrlB/$name" }
}

# Clear/create the output file
"" | Out-File -FilePath $outputFile -Encoding utf8

$total = $targets.Count
$i = 0

foreach ($t in $targets) {
  $i++
  Write-Host "[$i/$total] Testing $($t.Name)..."

  $responseText = ""

  try {
    $r = Invoke-WebRequest -Uri $t.Url -UseBasicParsing -Method GET -ErrorAction Stop
    $responseText = $r.Content
  } catch {
    if ($_.Exception.Response) {
      $statusCode = [int]$_.Exception.Response.StatusCode
      $body = $_.ErrorDetails.Message
      if ($body) {
        $responseText = "HTTP $statusCode`n$body"
      } else {
        $responseText = "HTTP $statusCode (no response body)"
      }
    } else {
      $responseText = "Request failed: $($_.Exception.Message)"
    }
  }

  $block = @"
==================================================
Edge Function: $($t.Name)
URL: $($t.Url)
Response:
$responseText
==================================================

"@

  Add-Content -Path $outputFile -Value $block -Encoding utf8
}

Write-Host "`nDone. Results written to $outputFile"
