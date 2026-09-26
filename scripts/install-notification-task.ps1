[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$TaskName = 'FitConnect-ProcessNotifications',
    [string]$XamppRoot = 'C:\xampp'
)

$ErrorActionPreference = 'Stop'
$phpExe = (Resolve-Path -LiteralPath (Join-Path $XamppRoot 'php\php.exe')).Path
$workerPath = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\backend\scripts\process-notifications.php')).Path
$powershellExe = (Get-Command powershell.exe).Source
$hiddenCommand = "& '$phpExe' '$workerPath'"
$arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -Command `"$hiddenCommand`""

Write-Output "TaskName=$TaskName"
Write-Output 'IntervalMinutes=1'
Write-Output 'WindowStyle Hidden'
Write-Output "Command=$powershellExe $arguments"

if ($PSCmdlet.ShouldProcess($TaskName, 'Register hidden one-minute notification task')) {
    $action = New-ScheduledTaskAction -Execute $powershellExe -Argument $arguments
    $trigger = New-ScheduledTaskTrigger `
        -Once `
        -At (Get-Date).AddMinutes(1) `
        -RepetitionInterval (New-TimeSpan -Minutes 1)
    $settings = New-ScheduledTaskSettingsSet `
        -StartWhenAvailable `
        -AllowStartIfOnBatteries `
        -DontStopIfGoingOnBatteries `
        -MultipleInstances IgnoreNew `
        -Hidden

    Register-ScheduledTask `
        -TaskName $TaskName `
        -Action $action `
        -Trigger $trigger `
        -Settings $settings `
        -Description 'Create FitConnect appointment reminders and retry queued Gmail notifications.' `
        -Force | Out-Null

    Write-Output 'Installed=true'
}
