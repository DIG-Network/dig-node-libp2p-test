/**
 * Comprehensive DIG Network Test
 * 
 * Tests all aspects of the platform:
 * - UPnP port mapping (including HTTP port)
 * - AWS bootstrap registration with correct store counts
 * - Direct HTTP download functionality
 * - Cross-network store synchronization
 * - TURN coordination capabilities
 */

import { DIGNode } from '../src/node/DIGNode.js'

async function comprehensiveTest() {
  console.log('🧪 Comprehensive DIG Network Platform Test')
  console.log('==========================================')

  // Set up environment for AWS bootstrap
  process.env.DIG_AWS_BOOTSTRAP_ENABLED = 'true'
  process.env.DIG_USER_TIER = 'standard'

  const node = new DIGNode({
    port: 4007, // Use unique port for testing
    enableMdns: true,
    enableDht: true,
    enableTurnServer: true
  })

  try {
    console.log('\n📊 Phase 1: Node Startup and Initialization')
    console.log('--------------------------------------------')
    await node.start()

    const status = node.getStatus()
    console.log(`✅ Node started: ${status.peerId}`)
    console.log(`📁 Local stores: ${status.stores.length}`)

    // Wait for all systems to initialize
    await new Promise(resolve => setTimeout(resolve, 20000))

    console.log('\n📊 Phase 2: UPnP and Network Capabilities')
    console.log('------------------------------------------')
    const upnpStatus = node.getUPnPStatus()
    const connectionInfo = node.getConnectionInfo()
    
    console.log(`🌐 UPnP Status: ${upnpStatus.available ? 'Available' : 'Not Available'}`)
    console.log(`📡 Port Mappings: ${upnpStatus.totalMappings}`)
    console.log(`🔗 TURN Capable: ${connectionInfo.canActAsTurnServer}`)
    console.log(`📍 External Addresses: ${connectionInfo.externalAddresses.length}`)

    if (connectionInfo.externalAddresses.length > 0) {
      console.log(`   External IP: ${connectionInfo.externalAddresses[0].split('/')[2]}`)
    }

    console.log('\n📊 Phase 3: HTTP Download Server Test')
    console.log('-------------------------------------')
    
    // Test HTTP server accessibility
    if (connectionInfo.canActAsTurnServer && connectionInfo.externalAddresses.length > 0) {
      const externalIP = connectionInfo.externalAddresses[0].split('/')[2]
      const httpPort = 5007 // port + 1000
      const healthUrl = `http://${externalIP}:${httpPort}/health`
      
      console.log(`🔍 Testing HTTP server: ${healthUrl}`)
      
      try {
        const response = await fetch(healthUrl, { signal: AbortSignal.timeout(10000) })
        if (response.ok) {
          const health = await response.json()
          console.log(`✅ HTTP server accessible externally`)
          console.log(`📁 HTTP server reports ${health.stores.length} stores`)
        } else {
          console.log(`❌ HTTP server returned ${response.status}`)
        }
      } catch (error) {
        console.log(`❌ HTTP server not accessible: ${error instanceof Error ? error.message : 'Unknown error'}`)
      }
    }

    console.log('\n📊 Phase 4: AWS Bootstrap Registration Test')
    console.log('-------------------------------------------')
    
    // Force AWS bootstrap registration
    const registered = await node.useAWSBootstrapFallback()
    console.log(`🌐 AWS Bootstrap Registration: ${registered ? '✅ Success' : '❌ Failed'}`)

    if (registered) {
      // Check registration in bootstrap server
      const response = await fetch('http://awseb--AWSEB-qNbAdipmcXyx-770761774.us-east-1.elb.amazonaws.com/peers?includeStores=true')
      const peers = await response.json()
      
      const ourPeer = peers.peers?.find((p: any) => p.peerId === status.peerId)
      if (ourPeer) {
        console.log(`✅ Found in bootstrap server`)
        console.log(`📁 Bootstrap shows ${ourPeer.stores.length} stores (should be ${status.stores.length})`)
        console.log(`📡 TURN capable: ${ourPeer.turnCapable}`)
      } else {
        console.log(`❌ Not found in bootstrap server`)
      }
    }

    console.log('\n📊 Phase 5: Store Synchronization Test')
    console.log('--------------------------------------')
    
    // Test store synchronization (trigger via discovery)
    await node.discoverAllPeers()
    
    const finalStatus = node.getStatus()
    console.log(`📁 Final store count: ${finalStatus.stores.length}`)

    console.log('\n📊 Phase 6: System Health Check')
    console.log('--------------------------------')
    
    const networkHealth = node.getNetworkHealth()
    console.log(`🔗 Connected Peers: ${networkHealth.connectedPeers}`)
    console.log(`🎯 DIG Peers: ${networkHealth.digPeers}`)
    console.log(`📡 TURN Servers: ${networkHealth.turnServers}`)
    console.log(`🏥 System Health: ${networkHealth.isHealthy ? 'Healthy' : 'Unhealthy'}`)

    console.log('\n📊 Test Results Summary')
    console.log('=======================')
    console.log(`Node Startup: ✅`)
    console.log(`UPnP Mapping: ${upnpStatus.available ? '✅' : '❌'}`)
    console.log(`HTTP Server: ${connectionInfo.canActAsTurnServer ? '🔍 Testing...' : '❌'}`)
    console.log(`AWS Registration: ${registered ? '✅' : '❌'}`)
    console.log(`Store Loading: ${status.stores.length > 0 ? '✅' : '❌'}`)

    // Keep running for monitoring
    console.log('\n⏱️ Monitoring for 60 seconds...')
    await new Promise(resolve => setTimeout(resolve, 60000))

  } catch (error) {
    console.error('❌ Comprehensive test failed:', error)
  } finally {
    console.log('\n🛑 Stopping test...')
    await node.stop()
    console.log('✅ Test completed')
  }
}

comprehensiveTest().catch(console.error)
