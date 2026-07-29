# Béla Home Kitchen -- Windows port forwarding beállítás
# Futtasd egyszer adminisztrátorként (jobb klikk -> Futtatás rendszergazdaként)

$wslIp = (wsl hostname -I).Trim().Split(" ")[0]
Write-Host "WSL2 IP: $wslIp"

# Port forwarding: Windows 3421 -> WSL 3421
netsh interface portproxy add v4tov4 listenport=3421 listenaddress=0.0.0.0 connectport=3421 connectaddress=$wslIp
Write-Host "Port forwarding OK"

# Tűzfal szabály
netsh advfirewall firewall add rule name="Bela Home Kitchen" dir=in action=allow protocol=TCP localport=3421
Write-Host "Tűzfal szabály OK"

# Ellenőrzés
Write-Host ""
Write-Host "=== Kész! A tablet böngészőjébe ezt írd be: ==="
$winIp = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object {$_.InterfaceAlias -notlike "*Loopback*" -and $_.InterfaceAlias -notlike "*WSL*"} | Select-Object -First 1).IPAddress
Write-Host "http://${winIp}:3421"
Write-Host ""
Write-Host "Ha a port forwarding WSL újraindítás után elvész, futtasd újra ezt a scriptet."
