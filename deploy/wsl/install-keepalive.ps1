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
