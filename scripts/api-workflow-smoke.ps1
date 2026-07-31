[CmdletBinding()]
param(
    [ValidateSet('availability', 'admin', 'booking', 'all')]
    [string]$Scenario = 'all',
    [string]$ApiUrl = 'http://localhost/fitconnect-api'
)

$ErrorActionPreference = 'Stop'

function Assert-True {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { throw $Message }
}

function Login {
    param([string]$Email)
    $body = @{ email = $Email; password = 'password' } | ConvertTo-Json
    return (Invoke-RestMethod -Method Post -Uri "$ApiUrl/v1/auth/login" -ContentType 'application/json' -Body $body).data
}

function Auth-Headers {
    param([string]$Token)
    return @{ Authorization = "Bearer $Token" }
}

function Expect-Status {
    param([int]$Status, [scriptblock]$Action)
    try {
        & $Action | Out-Null
    } catch {
        $actual = [int]$_.Exception.Response.StatusCode
        Assert-True ($actual -eq $Status) "Expected HTTP $Status, got $actual"
        return
    }
    throw "Expected HTTP $Status, request succeeded"
}

if ($Scenario -in @('availability', 'all')) {
    $trainer = Login 'trainer.a@fitconnect.local'
    $trainerHeaders = Auth-Headers $trainer.token
    $startsAt = (Get-Date).ToUniversalTime().AddDays(7).AddMinutes((Get-Random -Minimum 1 -Maximum 300)).ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
    $endsAt = ([DateTime]::Parse($startsAt)).ToUniversalTime().AddHours(1).ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
    $body = @{ startsAt = $startsAt; endsAt = $endsAt } | ConvertTo-Json

    $created = (Invoke-RestMethod -Method Post -Uri "$ApiUrl/v1/availability-slots" -Headers $trainerHeaders -ContentType 'application/json' -Body $body).data
    Assert-True ($created.state -eq 'available') 'New slot must be available'

    Expect-Status 409 {
        Invoke-RestMethod -Method Post -Uri "$ApiUrl/v1/availability-slots" -Headers $trainerHeaders -ContentType 'application/json' -Body $body
    }

    $overlapBody = @{
        startsAt = ([DateTime]::Parse($startsAt)).ToUniversalTime().AddMinutes(30).ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
        endsAt = ([DateTime]::Parse($endsAt)).ToUniversalTime().AddMinutes(30).ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
    } | ConvertTo-Json
    Expect-Status 409 {
        Invoke-RestMethod -Method Post -Uri "$ApiUrl/v1/availability-slots" -Headers $trainerHeaders -ContentType 'application/json' -Body $overlapBody
    }

    $workspace = (Invoke-RestMethod -Method Get -Uri "$ApiUrl/v1/trainer/me" -Headers $trainerHeaders).data
    Assert-True (($workspace.slots.id -contains $created.id)) 'Trainer workspace must include the new slot'

    $publicTrainer = (Invoke-RestMethod -Method Get -Uri "$ApiUrl/v1/trainers/demo-trainer-a").data
    Assert-True (($publicTrainer.slots.id -contains $created.id)) 'Public trainer profile must include the available slot'
    Assert-True (-not ($publicTrainer.slots.id -contains 102)) 'Public trainer profile must hide held slots'
    Assert-True (-not ($publicTrainer.slots.available -contains $false)) 'Every public slot must be available'

    Invoke-RestMethod -Method Delete -Uri "$ApiUrl/v1/availability-slots/$($created.id)" -Headers $trainerHeaders | Out-Null

    $pendingTrainer = Login 'trainer.c@fitconnect.local'
    $pendingHeaders = Auth-Headers $pendingTrainer.token
    Expect-Status 403 {
        Invoke-RestMethod -Method Post -Uri "$ApiUrl/v1/availability-slots" -Headers $pendingHeaders -ContentType 'application/json' -Body $body
    }
}

Write-Host "PASS API workflow scenario: $Scenario"
