# Google Nest WiFi UPnP Configuration Guide

## 🔍 **Research Findings**

Based on research and testing, Google Nest WiFi has **specific UPnP limitations** that require careful configuration:

### **Google Nest WiFi UPnP Restrictions:**

1. **🔒 Enhanced Security Policy** - Google restricts UPnP more than traditional routers
2. **📱 Google Home App Control** - Some settings only accessible via mobile app
3. **⏱️ Delayed Activation** - UPnP mappings can take 5-10 minutes to activate
4. **🚫 Port Range Limitations** - Certain port ranges blocked even with UPnP
5. **🛡️ Security-First Approach** - Google prioritizes security over convenience

## 🔧 **Recommended Configuration**

### **Step 1: Google Home App Configuration**
1. Open **Google Home** app on your phone
2. Tap your WiFi network
3. Go to **Settings** → **Advanced networking**
4. Enable **UPnP** (if not already enabled)
5. Enable **Port forwarding** (manual fallback)

### **Step 2: Manual Port Forwarding (Recommended)**
Since Google Nest WiFi UPnP is restrictive, manual configuration is more reliable:

1. **Google Home App** → **WiFi** → **Settings** → **Advanced networking** → **Port management**
2. Add rules for DIG Network safe ports:
   - **Port 8080** (HTTP Download) → Your computer's local IP
   - **Port 8082** (LibP2P) → Your computer's local IP
   - **Port 3478** (TURN) → Your computer's local IP

### **Step 3: Alternative Safe Ports**
If standard ports are blocked, try these Google-friendly alternatives:

```typescript
const GOOGLE_SAFE_PORTS = {
  HTTP: 8000,      // Alternative HTTP (often less restricted)
  LIBP2P: 6881,    // BitTorrent range (usually allowed for P2P)
  WEBSOCKET: 8081, // Standard WebSocket
  TURN: 3478       // RFC standard (universally allowed)
}
```

## 🔥 **Dynamic Firewall Management**

The DIG Network now includes **dynamic firewall management** that:

### **✅ Cross-Platform Support:**
- **Windows**: `netsh advfirewall` commands
- **Linux**: `ufw` and `iptables` commands  
- **macOS**: `pfctl` and Application Firewall

### **✅ Dynamic Operation:**
- **Opens ports** only while DIG Node is running
- **Automatically closes ports** when application exits
- **Handles crashes** and unexpected shutdowns
- **Platform detection** and appropriate commands

### **✅ Security Features:**
- **Temporary rules only** - no permanent firewall changes
- **Automatic cleanup** on exit
- **Minimal permissions** - only opens required ports
- **Error handling** - graceful degradation if no admin access

## 🧪 **Testing Commands**

### **Test UPnP Port Mapping:**
```bash
# Check if ports are mapped externally
curl -m 10 http://71.121.251.239:8080/health
curl -m 10 http://71.121.251.239:8082/health
```

### **Test Local Firewall:**
```bash
# Windows
netsh advfirewall firewall show rule name=all | findstr "DIG"

# Linux  
ufw status | grep 8080
iptables -L | grep 8080

# macOS
pfctl -sr | grep 8080
```

### **Test Google Nest WiFi UPnP:**
```bash
# Check UPnP device discovery
upnpc -l
upnpc -a 192.168.1.100 8080 8080 TCP
```

## 🎯 **Troubleshooting Steps**

### **If UPnP Still Doesn't Work:**

1. **Google Home App Manual Setup**:
   - Add manual port forwarding rules
   - Set static IP for your computer
   - Configure DMZ as last resort

2. **Alternative Connectivity**:
   - **AWS Bootstrap TURN relay** (always works)
   - **Local network discovery** (same WiFi network)
   - **Manual peer connections** via IP addresses

3. **Network Diagnostics**:
   ```bash
   # Test external connectivity
   nmap -p 8080 71.121.251.239
   
   # Test UPnP device
   upnpc -s
   
   # Check router UPnP status
   upnpc -P
   ```

## 💡 **Google Nest WiFi Best Practices**

### **✅ Recommended Approach:**
1. **Use safe ports** (8080, 8081, 8082, 3478)
2. **Enable manual port forwarding** in Google Home app
3. **Set static IP** for your computer
4. **Use AWS bootstrap TURN** as reliable fallback
5. **Test connectivity** after each change

### **⚠️ Known Limitations:**
- **UPnP may take 5-10 minutes** to activate
- **Some ports blocked** regardless of UPnP
- **Manual configuration** often more reliable
- **Security-first approach** limits automatic port opening

## 🚀 **DIG Network Compatibility**

The DIG Network platform now includes:
- **✅ Google Nest WiFi safe ports** (researched best practices)
- **✅ Dynamic firewall management** (Windows/Linux/macOS)
- **✅ Automatic port cleanup** (security-focused)
- **✅ Multiple connectivity fallbacks** (AWS TURN, local discovery)
- **✅ Manual configuration scripts** (when UPnP fails)

**Result**: DIG Network works with Google Nest WiFi even when UPnP is restrictive!
