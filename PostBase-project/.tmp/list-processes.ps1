Get-CimInstance Win32_Process |
  Where-Object { $_.CommandLine -match 'workerd|wrangler|vinext|vite' } |
  ForEach-Object { "{0} :: {1}" -f $_.ProcessId, $_.CommandLine }
