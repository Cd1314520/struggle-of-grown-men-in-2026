# Registers a Windows scheduled task that starts the WSL distro at boot and keeps it running.
# WSL stops a distro soon after its last wsl.exe session ends, systemd services or not, so without
# this the app (deploy/systemd/) stops when the last terminal closes.
#
# From an elevated PowerShell on Windows:
#   powershell -ExecutionPolicy Bypass -File install-keepalive.ps1 -Distro Ubuntu
# To remove it: Unregister-ScheduledTask -TaskName "auto-apply WSL keepalive"
#Requires -RunAsAdministrator
param(
  [string]$Distro = "Ubuntu",
  [string]$TaskName = "auto-apply WSL keepalive"
)
$ErrorActionPreference = "Stop"

if (-not ((wsl.exe --list --quiet) -replace "`0", "" | Where-Object { $_.Trim() -eq $Distro })) {
  throw "No WSL distro named '$Distro'; see wsl --list"
}

$action = New-ScheduledTaskAction -Execute "wsl.exe" -Argument "-d $Distro --exec sleep infinity"
$trigger = New-ScheduledTaskTrigger -AtStartup
# S4U runs the task whether or not you are logged on, with no window to close by mistake and no password stored.
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType S4U
$settings = New-ScheduledTaskSettingsSet `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
  -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 5
$info = Get-ScheduledTaskInfo -TaskName $TaskName
Write-Host "Task '$TaskName': $((Get-ScheduledTask -TaskName $TaskName).State), last result $($info.LastTaskResult)"
