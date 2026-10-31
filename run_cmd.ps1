$toolsDir = "C:\Users\dell\.gemini\antigravity\scratch\tools"
$env:PATH = "C:\Users\dell\.gemini\antigravity\scratch\setu-project\SETU-React-Clickable\node_modules\.bin;$toolsDir\node-v20.18.0-win-x64;$env:PATH"
Set-Location "C:\Users\dell\.gemini\antigravity\scratch\setu-project\SETU-React-Clickable"
& $args[0] $args[1..($args.Length - 1)]
