# Navigation stack bisection — switch versions without touching other app code.
# Usage:
#   .\scripts\restore-nav-stack.ps1              # show current + list
#   .\scripts\restore-nav-stack.ps1 -Step 10     # restore step 10 (68804f4)
#   .\scripts\restore-nav-stack.ps1 -Older       # one step toward older
#   .\scripts\restore-nav-stack.ps1 -Newer       # one step toward newer

param(
    [int]$Step = 0,
    [switch]$Older,
    [switch]$Newer,
    [switch]$List
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

# Newest (11) → Oldest (1). Test order: start at 10, then -Older until nav feels good.
$Versions = @(
    @{ Step = 11; Commit = '3929121'; Label = 'HEAD - newest (forward-pull + cache)' },
    @{ Step = 10; Commit = '68804f4'; Label = 'Vorletzte - forward-pull, MOBILE_VV preview' },
    @{ Step = 9;  Commit = 'f49c083'; Label = 'Update Blyve' },
    @{ Step = 8;  Commit = '161ec89'; Label = 'Update Blyve' },
    @{ Step = 7;  Commit = '323026c'; Label = 'Large forward-swipe hook (~235 lines)' },
    @{ Step = 6;  Commit = '5f18712'; Label = 'Update Blyve' },
    @{ Step = 5;  Commit = '5c193da'; Label = 'Forward swipe + lastOpened chat introduced' },
    @{ Step = 4;  Commit = '758de4d'; Label = 'Update Blyve' },
    @{ Step = 3;  Commit = 'cad7758'; Label = 'Update Blyve' },
    @{ Step = 2;  Commit = 'ba50ec7'; Label = 'mobile viewport insets in stack' },
    @{ Step = 1;  Commit = '4b422eb'; Label = 'Simple AnimatePresence stack (no forward swipe)' },
    @{ Step = 0;  Commit = '8d4e3f1'; Label = 'Initial - edge-only back, console logs' }
)

$MarkerFile = Join-Path $Root 'scripts\.nav-stack-step'

function Get-CurrentStep {
    if (Test-Path $MarkerFile) {
        $raw = Get-Content $MarkerFile -Raw
        if ($raw -match '^\d+$') { return [int]$raw }
    }
    return 10
}

function Show-List {
    $cur = Get-CurrentStep
    Write-Host ''
    Write-Host 'Nav stack versions (test: start Step 10, then -Older):'
    foreach ($v in $Versions) {
        $mark = if ($v.Step -eq $cur) { ' <-- ACTIVE' } else { '' }
        Write-Host ("  Step {0,2}: {1}  {2}{3}" -f $v.Step, $v.Commit.Substring(0,7), $v.Label, $mark)
    }
    Write-Host ''
}

function Restore-Step([int]$targetStep) {
    $entry = $Versions | Where-Object { $_.Step -eq $targetStep } | Select-Object -First 1
    if (-not $entry) {
        Write-Error "Unknown step $targetStep. Use -List or run without args."
    }

    $commit = $entry.Commit
    Write-Host "Restoring nav stack Step $targetStep ($commit)..."

    git checkout $commit -- src/app/components/NavigationStack.tsx

    $navOrchestrator = 'src/app/components/MobileNavStack.tsx'
    $legacyHook = 'src/app/hooks/useEdgeBackNavigation.tsx'
    $hasMobileNavStack = git cat-file -e "${commit}:${navOrchestrator}" 2>$null; $LASTEXITCODE -eq 0
    $hasLegacyHook = git cat-file -e "${commit}:${legacyHook}" 2>$null; $LASTEXITCODE -eq 0
    if ($hasMobileNavStack) {
        git checkout $commit -- $navOrchestrator
    } elseif ($hasLegacyHook) {
        git checkout $commit -- $legacyHook
    } else {
        Write-Warning "No MobileNavStack or useEdgeBackNavigation at $commit — only NavigationStack restored."
    }

    $shellStylePath = 'src/app/lib/navigationShellStyle.ts'
    $hasShellStyle = git cat-file -e "${commit}:${shellStylePath}" 2>$null; $LASTEXITCODE -eq 0
    if ($hasShellStyle) {
        git checkout $commit -- $shellStylePath
    }

    $needsForward = $targetStep -ge 5
    $msgPath = Join-Path $Root 'src/app/components/MessagesScreen.tsx'
    $msg = Get-Content $msgPath -Raw

    if ($needsForward) {
        if ($msg -notmatch 'lastOpenedConversationIdRef') {
            $msg = $msg -replace '(pendingConversationIdRef = useRef[^\r\n]+)', "`$1`r`n  const lastOpenedConversationIdRef = useRef<string | null>(null);"
        }
        if ($msg -notmatch 'lastOpenedConversationIdRef\.current = conv\.id') {
            $msg = $msg -replace '(const imageUrl = otherUser\.imageUrl[^\r\n]+)', "`$1`r`n      lastOpenedConversationIdRef.current = conv.id;"
        }
        if ($msg -notmatch 'reopenLastConversation') {
            $msg = $msg -replace '(const handleNavigationStackChange = React\.useCallback)', @"
  const reopenLastConversation = React.useCallback(() => {
    const conversationId = lastOpenedConversationIdRef.current;
    if (!conversationId || !currentUserId) return;
    lastPushedChatIdRef.current = conversationId;
    openConversationById(conversationId);
  }, [currentUserId, openConversationById]);

  `$1
"@
        }
        if ($msg -notmatch 'onForwardSwipe') {
            $msg = $msg -replace '(onStackChange: handleNavigationStackChange,)\s*\)', "`$1`r`n    onForwardSwipe: reopenLastConversation,`r`n  )"
        }
    } else {
        $msg = $msg -replace '\r?\n  const lastOpenedConversationIdRef = useRef<string \| null>\(null\);', ''
        $msg = $msg -replace '\r?\n      lastOpenedConversationIdRef\.current = conv\.id;', ''
        $msg = $msg -replace '(?s)\r?\n  const reopenLastConversation = React\.useCallback\(\(\) => \{.*?\}, \[currentUserId, openConversationById\]\);\r?\n', "`r`n"
        $msg = $msg -replace ',\r?\n    onForwardSwipe: reopenLastConversation', ''
    }

    Set-Content -Path $msgPath -Value $msg -NoNewline

    Set-Content -Path $MarkerFile -Value "$targetStep" -NoNewline
    Write-Host "Done. Active: Step $targetStep - $($entry.Label)"
    Write-Host 'Restart dev server + hard reload, then test mobile swipe back/forward.'
}

if ($List -or ($Step -eq 0 -and -not $Older -and -not $Newer)) {
    Show-List
    if ($Step -eq 0 -and -not $Older -and -not $Newer) { exit 0 }
}

$current = Get-CurrentStep
if ($Older) { $Step = $current - 1 }
elseif ($Newer) { $Step = $current + 1 }
elseif ($Step -eq 0) { $Step = $current }

Restore-Step $Step
