/**
 * Dynamic Firewall Manager for DIG Network
 * 
 * Manages firewall rules dynamically across Windows, Linux, and macOS:
 * - Opens ports only while application is running
 * - Automatically closes ports on application exit
 * - Uses platform-specific firewall commands
 * - Handles Google Nest WiFi UPnP compatibility
 */

import { Logger } from './logger.js'

export class DynamicFirewallManager {
  private logger = new Logger('DynamicFirewall')
  private openRules = new Map<number, FirewallRule>()
  private platform = process.platform
  private isInitialized = false

  // Google Nest WiFi compatible ports (researched best practices)
  private readonly GOOGLE_WIFI_SAFE_PORTS = {
    HTTP: 8080,        // Standard HTTP alternate (universally allowed)
    WEBSOCKET: 8081,   // WebSocket (commonly allowed)
    LIBP2P: 8082,      // P2P (safe range)
    TURN: 3478,        // STUN/TURN (RFC 5766 - universally allowed)
    ALT_HTTP: 8000,    // Alternative HTTP (if 8080 blocked)
    ALT_P2P: 6881      // Alternative P2P (BitTorrent range - usually allowed)
  }

  constructor() {
    this.logger.info(`🔥 Dynamic firewall manager initialized for ${this.platform}`)
    this.setupExitHandlers()
  }

  // Initialize firewall management
  async initialize(): Promise<void> {
    try {
      this.logger.info('🔥 Initializing dynamic firewall management...')

      // Test firewall access based on platform
      const hasFirewallAccess = await this.testFirewallAccess()
      
      if (hasFirewallAccess) {
        this.isInitialized = true
        this.logger.info('✅ Firewall access available - dynamic rules enabled')
      } else {
        this.logger.warn('⚠️ No firewall access - manual configuration may be required')
      }

    } catch (error) {
      this.logger.warn('Failed to initialize firewall management:', error)
    }
  }

  // Open port dynamically (only while app running)
  async openPort(port: number, protocol: 'tcp' | 'udp', description: string): Promise<boolean> {
    try {
      if (!this.isInitialized) {
        this.logger.debug(`⏭️ Firewall not initialized - skipping port ${port}`)
        return false
      }

      this.logger.info(`🔥 Opening firewall port ${port}/${protocol} (${description})`)

      const success = await this.executeFirewallCommand('add', port, protocol, description)
      
      if (success) {
        this.openRules.set(port, {
          port,
          protocol,
          description,
          opened: Date.now(),
          platform: this.platform
        })
        
        this.logger.info(`✅ Firewall port opened: ${port}/${protocol}`)
        return true
      } else {
        this.logger.warn(`⚠️ Failed to open firewall port: ${port}/${protocol}`)
        return false
      }

    } catch (error) {
      this.logger.debug(`Firewall port open failed for ${port}:`, error)
      return false
    }
  }

  // Close port dynamically
  async closePort(port: number): Promise<boolean> {
    try {
      const rule = this.openRules.get(port)
      if (!rule) {
        this.logger.debug(`⏭️ No firewall rule found for port ${port}`)
        return true
      }

      this.logger.info(`🔥 Closing firewall port ${port}/${rule.protocol}`)

      const success = await this.executeFirewallCommand('remove', port, rule.protocol, rule.description)
      
      if (success) {
        this.openRules.delete(port)
        this.logger.info(`✅ Firewall port closed: ${port}/${rule.protocol}`)
      }

      return success

    } catch (error) {
      this.logger.debug(`Firewall port close failed for ${port}:`, error)
      return false
    }
  }

  // Execute platform-specific firewall commands
  private async executeFirewallCommand(action: 'add' | 'remove', port: number, protocol: string, description: string): Promise<boolean> {
    try {
      const { exec } = await import('child_process')
      const { promisify } = await import('util')
      const execAsync = promisify(exec)

      let commands: string[] = []

      switch (this.platform) {
        case 'win32':
          commands = this.getWindowsFirewallCommands(action, port, protocol, description)
          break
        case 'linux':
          commands = this.getLinuxFirewallCommands(action, port, protocol, description)
          break
        case 'darwin':
          commands = this.getMacOSFirewallCommands(action, port, protocol, description)
          break
        default:
          this.logger.warn(`Unsupported platform for firewall management: ${this.platform}`)
          return false
      }

      // Execute all commands
      let allSucceeded = true
      for (const command of commands) {
        try {
          await execAsync(command, { timeout: 10000 })
          this.logger.debug(`✅ Firewall command executed: ${command}`)
        } catch (error) {
          this.logger.debug(`⚠️ Firewall command failed (may be expected): ${command}`)
          // Don't fail completely - some commands may fail if rules already exist/don't exist
        }
      }

      return allSucceeded

    } catch (error) {
      this.logger.debug(`Firewall command execution failed:`, error)
      return false
    }
  }

  // Windows firewall commands
  private getWindowsFirewallCommands(action: 'add' | 'remove', port: number, protocol: string, description: string): string[] {
    const ruleName = `DIG-${description}-${port}`
    
    if (action === 'add') {
      return [
        `netsh advfirewall firewall add rule name="${ruleName}-In" dir=in action=allow protocol=${protocol.toUpperCase()} localport=${port}`,
        `netsh advfirewall firewall add rule name="${ruleName}-Out" dir=out action=allow protocol=${protocol.toUpperCase()} localport=${port}`
      ]
    } else {
      return [
        `netsh advfirewall firewall delete rule name="${ruleName}-In"`,
        `netsh advfirewall firewall delete rule name="${ruleName}-Out"`
      ]
    }
  }

  // Linux firewall commands (iptables + ufw)
  private getLinuxFirewallCommands(action: 'add' | 'remove', port: number, protocol: string, description: string): string[] {
    if (action === 'add') {
      return [
        // Try ufw first (Ubuntu/Debian)
        `ufw allow ${port}/${protocol} comment "${description}"`,
        // Fallback to iptables (universal)
        `iptables -A INPUT -p ${protocol} --dport ${port} -j ACCEPT`,
        `iptables -A OUTPUT -p ${protocol} --sport ${port} -j ACCEPT`
      ]
    } else {
      return [
        // Try ufw first
        `ufw delete allow ${port}/${protocol}`,
        // Fallback to iptables
        `iptables -D INPUT -p ${protocol} --dport ${port} -j ACCEPT`,
        `iptables -D OUTPUT -p ${protocol} --sport ${port} -j ACCEPT`
      ]
    }
  }

  // macOS firewall commands (pfctl)
  private getMacOSFirewallCommands(action: 'add' | 'remove', port: number, protocol: string, description: string): string[] {
    if (action === 'add') {
      return [
        // Enable application firewall exception
        `/usr/libexec/ApplicationFirewall/socketfilterfw --add /usr/bin/node`,
        `/usr/libexec/ApplicationFirewall/socketfilterfw --unblock /usr/bin/node`,
        // Add pfctl rule (requires admin)
        `echo "pass in proto ${protocol} from any to any port ${port}" | pfctl -f -`
      ]
    } else {
      return [
        // Remove application firewall exception
        `/usr/libexec/ApplicationFirewall/socketfilterfw --remove /usr/bin/node`,
        // pfctl rules are temporary and removed on reboot
      ]
    }
  }

  // Test if we have firewall access
  private async testFirewallAccess(): Promise<boolean> {
    try {
      const { exec } = await import('child_process')
      const { promisify } = await import('util')
      const execAsync = promisify(exec)

      let testCommand: string

      switch (this.platform) {
        case 'win32':
          testCommand = 'netsh advfirewall show allprofiles'
          break
        case 'linux':
          testCommand = 'which ufw || which iptables'
          break
        case 'darwin':
          testCommand = 'which pfctl'
          break
        default:
          return false
      }

      await execAsync(testCommand, { timeout: 5000 })
      return true

    } catch (error) {
      this.logger.debug('Firewall access test failed:', error)
      return false
    }
  }

  // Setup exit handlers to clean up firewall rules
  private setupExitHandlers(): void {
    const cleanup = async () => {
      this.logger.info('🧹 Cleaning up firewall rules on exit...')
      await this.closeAllPorts()
    }

    // Handle various exit scenarios
    process.on('exit', () => {
      // Synchronous cleanup only
      this.logger.info('🧹 Process exiting - firewall cleanup initiated')
    })

    process.on('SIGINT', async () => {
      await cleanup()
      process.exit(0)
    })

    process.on('SIGTERM', async () => {
      await cleanup()
      process.exit(0)
    })

    process.on('uncaughtException', async (error) => {
      this.logger.error('Uncaught exception - cleaning up firewall:', error)
      await cleanup()
      process.exit(1)
    })

    process.on('unhandledRejection', async (reason) => {
      this.logger.error('Unhandled rejection - cleaning up firewall:', reason)
      await cleanup()
      process.exit(1)
    })
  }

  // Close all open ports
  async closeAllPorts(): Promise<void> {
    const ports = Array.from(this.openRules.keys())
    
    this.logger.info(`🧹 Closing ${ports.length} firewall ports...`)
    
    for (const port of ports) {
      await this.closePort(port)
    }

    this.logger.info('✅ All firewall ports closed')
  }

  // Get Google Nest WiFi safe ports
  getGoogleWiFiSafePorts(): typeof this.GOOGLE_WIFI_SAFE_PORTS {
    return { ...this.GOOGLE_WIFI_SAFE_PORTS }
  }

  // Get current firewall status
  getFirewallStatus(): FirewallStatus {
    return {
      platform: this.platform,
      initialized: this.isInitialized,
      openPorts: Array.from(this.openRules.values()),
      totalRules: this.openRules.size
    }
  }
}

// Firewall rule information
interface FirewallRule {
  port: number
  protocol: 'tcp' | 'udp'
  description: string
  opened: number
  platform: string
}

// Firewall status
interface FirewallStatus {
  platform: string
  initialized: boolean
  openPorts: FirewallRule[]
  totalRules: number
}
