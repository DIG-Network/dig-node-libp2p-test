/**
 * Safe Ports Test for Google Nest WiFi Compatibility
 * 
 * Tests DIG Network using UPnP-safe ports that Google Nest WiFi
 * and most routers typically allow through UPnP:
 * 
 * - HTTP: 8080 (Standard HTTP alternate)
 * - WebSocket: 8081 (Standard WebSocket)
 * - LibP2P: 8082 (Safe P2P range)
 * - TURN: 3478 (RFC 5766 standard)
 */

import { DIGNode } from '../src/node/DIGNode.js'

async function safePortsTest() {
  console.log('🔒 DIG Network Safe Ports Test (Google Nest WiFi Compatible)')
  console.log('===========================================================')
  console.log('')
  console.log('📡 Using UPnP-Safe Port Configuration:')
  console.log('  HTTP Download: 8080 (Standard HTTP alternate)')
  console.log('  WebSocket: 8081 (Standard WebSocket)')
  console.log('  LibP2P: 8082 (Safe P2P range)')
  console.log('  TURN: 3478 (RFC 5766 standard)')
  console.log('')

  // Set up environment
  process.env.DIG_AWS_BOOTSTRAP_ENABLED = 'true'
  process.env.DIG_USER_TIER = 'standard'

  const node = new DIGNode({
    port: 8082,      // Safe LibP2P port
    httpPort: 8080,  // Safe HTTP port
    wsPort: 8081,    // Safe WebSocket port
    turnPort: 3478,  // Standard TURN port
    enableMdns: true,
    enableDht: true,
    enableTurnServer: true
  })

  try {
    console.log('🚀 Starting DIG Node with Safe Ports...')
    await node.start()

    const status = node.getStatus()
    console.log(`✅ Node started: ${status.peerId?.substring(0, 20)}...`)
    console.log(`📁 Local stores: ${status.stores.length}`)

    // Wait for initialization
    await new Promise(resolve => setTimeout(resolve, 20000))

    console.log('\n🔍 Testing Port Accessibility...')
    const connectionInfo = node.getConnectionInfo()
    const upnpStatus = node.getUPnPStatus()
    
    console.log(`🌐 UPnP Status: ${upnpStatus.available ? 'Available' : 'Not Available'}`)
    console.log(`📡 Port Mappings: ${upnpStatus.totalMappings}`)
    console.log(`🔗 TURN Capable: ${connectionInfo.canActAsTurnServer}`)

    if (connectionInfo.externalAddresses.length > 0) {
      const externalIP = connectionInfo.externalAddresses[0].split('/')[2]
      console.log(`📍 External IP: ${externalIP}`)
      
      // Test HTTP server accessibility on safe port
      console.log('\n🧪 Testing HTTP Server on Safe Port 8080...')
      try {
        const response = await fetch(`http://${externalIP}:8080/health`, {
          signal: AbortSignal.timeout(10000)
        })
        
        if (response.ok) {
          const health = await response.json()
          console.log('✅ HTTP server accessible on port 8080!')
          console.log(`📁 Available stores: ${health.stores.length}`)
        } else {
          console.log(`❌ HTTP server responded with ${response.status}`)
        }
      } catch (error) {
        console.log(`❌ HTTP server not accessible: ${error instanceof Error ? error.message : 'Unknown error'}`)
        console.log('💡 Google Nest WiFi may need manual port forwarding for port 8080')
      }
    }

    // Test AWS bootstrap registration with safe ports
    console.log('\n🌐 Testing AWS Bootstrap Registration...')
    const registered = await node.useAWSBootstrapFallback()
    console.log(`AWS Registration: ${registered ? '✅ Success' : '❌ Failed'}`)

    if (registered) {
      // Check if peers can be discovered
      console.log('\n🔍 Testing Peer Discovery...')
      await node.discoverAllPeers()
      
      const networkHealth = node.getNetworkHealth()
      console.log(`Connected Peers: ${networkHealth.connectedPeers}`)
      console.log(`DIG Peers: ${networkHealth.digPeers}`)
      console.log(`TURN Servers: ${networkHealth.turnServers}`)
    }

    console.log('\n📊 Safe Ports Test Results:')
    console.log('===========================')
    console.log(`✅ Node Startup: Success`)
    console.log(`✅ Safe Port Configuration: ${upnpStatus.totalMappings} ports mapped`)
    console.log(`✅ UPnP Compatibility: ${upnpStatus.available ? 'Working' : 'Failed'}`)
    console.log(`✅ TURN Capability: ${connectionInfo.canActAsTurnServer ? 'Enabled' : 'Disabled'}`)
    console.log(`✅ AWS Bootstrap: ${registered ? 'Connected' : 'Failed'}`)

    // Monitor for 60 seconds
    console.log('\n⏱️ Monitoring for 60 seconds...')
    await new Promise(resolve => setTimeout(resolve, 60000))

  } catch (error) {
    console.error('❌ Safe ports test failed:', error)
  } finally {
    console.log('\n🛑 Stopping test...')
    await node.stop()
    console.log('✅ Safe ports test completed')
  }
}

safePortsTest().catch(console.error)
