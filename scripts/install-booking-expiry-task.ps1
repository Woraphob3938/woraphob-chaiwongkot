[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$TaskName = 'FitConnect-ExpireBookings',
    [string]$XamppRoot = 'C:\xampp'
)

$ErrorActionPreference = 'Stop'

$phpExe = (Resolve-Path (Join-Path $XamppRoot 'php\php.exe')).Path
$commandPath = (Resolve-Path (Join-Path $PSScriptRoot '..\backend\scripts\expire-bookings.php')).Path
$arguments = "`"$commandPath`""

Write-Output "TaskName=$TaskName"
Write-Output 'IntervalMinutes=1'
Write-Output 'RunsOnBattery=true'
Write-Output "Command=$phpExe $arguments"

if ($PSCmdlet.ShouldProcess($TaskName, 'Register one-minute booking expiry task')) {
    $action = New-ScheduledTaskAction -Execute $phpExe -Argument $arguments
    $trigger = New-ScheduledTaskTrigger `
        -Once `
        -At (Get-Date).AddMinutes(1) `
        -RepetitionInterval (New-TimeSpan -Minutes 1)
    $settings = New-ScheduledTaskSettingsSet `
        -StartWhenAvailable `
        -AllowStartIfOnBatteries `
        -DontStopIfGoingOnBatteries `
        -MultipleInstances IgnoreNew

    Register-ScheduledTask `
        -TaskName $TaskName `
        -Action $action `
        -Trigger $trigger `
        -Settings $settings `
        -Description 'Expire unpaid FitConnect bookings and release held availability.' `
        -Force | Out-Null

    Write-Output 'Installed=true'
}
