Get-CimInstance Win32_Process |
  Where-Object { $_.CommandLine -match 'workerd|wrangler|vinext' } |
  ForEach-Object { "{0}" -f $_.ProcessId }
