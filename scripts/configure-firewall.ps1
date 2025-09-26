# Configure Windows Firewall for DIG Network
# Run as Administrator

param(
    [int]$Port = 4001,
    [string]$Action = "add"
)

Write-Host "🔥 DIG Network Firewall Configuration" -ForegroundColor Cyan
Write-Host "====================================" -ForegroundColor Cyan
Write-Host ""

$HttpPort = $Port + 1000
$WsPort = $Port + 1
$TurnPort = $Port + 100

if ($Action -eq "add") {
    Write-Host "🔧 Adding firewall rules for DIG Network..." -ForegroundColor Yellow
    Write-Host ""

    # Main LibP2P port
    Write-Host "📡 Configuring LibP2P port: $Port"
    netsh advfirewall firewall add rule name="DIG-LibP2P-Main-Inbound" dir=in action=allow protocol=TCP localport=$Port | Out-Null
    netsh advfirewall firewall add rule name="DIG-LibP2P-Main-Outbound" dir=out action=allow protocol=TCP localport=$Port | Out-Null
    Write-Host "  ✅ LibP2P port $Port configured" -ForegroundColor Green

    # WebSocket port
    Write-Host "🌐 Configuring WebSocket port: $WsPort"
    netsh advfirewall firewall add rule name="DIG-WebSocket-Inbound" dir=in action=allow protocol=TCP localport=$WsPort | Out-Null
    netsh advfirewall firewall add rule name="DIG-WebSocket-Outbound" dir=out action=allow protocol=TCP localport=$WsPort | Out-Null
    Write-Host "  ✅ WebSocket port $WsPort configured" -ForegroundColor Green

    # HTTP Download port (CRITICAL)
    Write-Host "📁 Configuring HTTP Download port: $HttpPort"
    netsh advfirewall firewall add rule name="DIG-HTTP-Download-Inbound" dir=in action=allow protocol=TCP localport=$HttpPort | Out-Null
    netsh advfirewall firewall add rule name="DIG-HTTP-Download-Outbound" dir=out action=allow protocol=TCP localport=$HttpPort | Out-Null
    netsh advfirewall firewall add rule name="DIG-HTTP-Download-Remote" dir=in action=allow protocol=TCP localport=$HttpPort remoteip=any | Out-Null
    Write-Host "  ✅ HTTP Download port $HttpPort configured" -ForegroundColor Green

    # TURN port
    Write-Host "📡 Configuring TURN port: $TurnPort"
    netsh advfirewall firewall add rule name="DIG-TURN-TCP-Inbound" dir=in action=allow protocol=TCP localport=$TurnPort | Out-Null
    netsh advfirewall firewall add rule name="DIG-TURN-UDP-Inbound" dir=in action=allow protocol=UDP localport=$TurnPort | Out-Null
    Write-Host "  ✅ TURN port $TurnPort configured" -ForegroundColor Green

    Write-Host ""
    Write-Host "✅ DIG Network firewall configuration complete!" -ForegroundColor Green
    Write-Host ""
    Write-Host "📊 Configured Ports:" -ForegroundColor Cyan
    Write-Host "  📡 LibP2P: $Port"
    Write-Host "  🌐 WebSocket: $WsPort"
    Write-Host "  📁 HTTP Download: $HttpPort (CRITICAL for file sharing)"
    Write-Host "  📡 TURN: $TurnPort"

} elseif ($Action -eq "remove") {
    Write-Host "🧹 Removing firewall rules for DIG Network..." -ForegroundColor Yellow
    Write-Host ""

    $rules = @(
        "DIG-LibP2P-Main-Inbound",
        "DIG-LibP2P-Main-Outbound", 
        "DIG-WebSocket-Inbound",
        "DIG-WebSocket-Outbound",
        "DIG-HTTP-Download-Inbound",
        "DIG-HTTP-Download-Outbound",
        "DIG-HTTP-Download-Remote",
        "DIG-TURN-TCP-Inbound",
        "DIG-TURN-UDP-Inbound"
    )

    foreach ($rule in $rules) {
        try {
            netsh advfirewall firewall delete rule name=$rule | Out-Null
            Write-Host "  🧹 Removed: $rule" -ForegroundColor Gray
        } catch {
            # Silent failure - rule might not exist
        }
    }

    Write-Host ""
    Write-Host "✅ DIG Network firewall rules removed!" -ForegroundColor Green

} else {
    Write-Host "❌ Invalid action. Use 'add' or 'remove'" -ForegroundColor Red
    Write-Host ""
    Write-Host "Usage:" -ForegroundColor Cyan
    Write-Host "  .\configure-firewall.ps1 -Port 4001 -Action add"
    Write-Host "  .\configure-firewall.ps1 -Port 4001 -Action remove"
}

Write-Host ""
Write-Host "💡 Note: Run as Administrator for firewall modifications" -ForegroundColor Yellow
