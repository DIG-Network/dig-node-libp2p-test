/**
 * UPnP Test Script
 * 
 * Tests the enhanced UPnP functionality to ensure it properly:
 * 1. Detects external IP address
 * 2. Creates port mappings
 * 3. Integrates with LibP2P addresses
 * 4. Enables direct connections
 */

import { DIGNode } from '../src/node/DIGNode.js'

async function testUPnPFunctionality() {
  console.log('🧪 Testing UPnP Functionality...')
  console.log('================================')

  const node = new DIGNode({
    port: 4001,
    enableMdns: true,
    enableDht: true
  })

  try {
    // Start the node
    console.log('🚀 Starting DIG Node...')
    await node.start()

    // Wait a bit for UPnP initialization
    console.log('⏳ Waiting for UPnP initialization...')
    await new Promise(resolve => setTimeout(resolve, 10000))

    // Check node capabilities
    const capabilities = node.getNodeCapabilities()
    console.log('\n📋 Node Capabilities:')
    console.log(`   UPnP: ${capabilities.upnp ? '✅ Enabled' : '❌ Disabled'}`)
    console.log(`   AutoNAT: ${capabilities.autonat ? '✅ Enabled' : '❌ Disabled'}`)
    console.log(`   WebRTC: ${capabilities.webrtc ? '✅ Enabled' : '❌ Disabled'}`)

    // Check UPnP status
    const upnpStatus = node.getUPnPStatus()
    console.log('\n🌐 UPnP Status:')
    console.log(`   Available: ${upnpStatus.available ? '✅ Yes' : '❌ No'}`)
    console.log(`   Total Mappings: ${upnpStatus.totalMappings}`)
    console.log(`   Active Mappings: ${upnpStatus.activeMappings}`)
    
    if (upnpStatus.available) {
      console.log('   Port Mappings:')
      if (upnpStatus.portRanges.libp2p.length > 0) {
        console.log(`     LibP2P: ${upnpStatus.portRanges.libp2p.join(', ')}`)
      }
      if (upnpStatus.portRanges.websocket.length > 0) {
        console.log(`     WebSocket: ${upnpStatus.portRanges.websocket.join(', ')}`)
      }
      if (upnpStatus.portRanges.turn.length > 0) {
        console.log(`     TURN: ${upnpStatus.portRanges.turn.join(', ')}`)
      }
    }

    // Check external addresses
    const addresses = node.getMultiaddrs()
    const externalAddresses = addresses.filter(addr => {
      const addrStr = addr.toString()
      return !addrStr.includes('127.0.0.1') && 
             !addrStr.includes('192.168.') &&
             !addrStr.includes('10.0.') &&
             !addrStr.includes('172.1') &&
             !addrStr.includes('172.2') &&
             !addrStr.includes('172.3')
    })

    console.log('\n📡 Network Addresses:')
    console.log(`   Total Addresses: ${addresses.length}`)
    console.log(`   External Addresses: ${externalAddresses.length}`)
    
    if (externalAddresses.length > 0) {
      console.log('   External Addresses:')
      externalAddresses.forEach(addr => {
        console.log(`     ${addr.toString()}`)
      })
    }

    // Check connection capabilities
    const connectionInfo = node.getConnectionInfo()
    console.log('\n🔗 Connection Capabilities:')
    console.log(`   Can Accept Direct: ${connectionInfo.canAcceptDirectConnections ? '✅ Yes' : '❌ No'}`)
    console.log(`   Can Act as TURN: ${connectionInfo.canActAsTurnServer ? '✅ Yes' : '❌ No'}`)
    console.log(`   Connection Methods: ${connectionInfo.availableConnectionMethods.join(', ')}`)

    // Test results
    console.log('\n📊 Test Results:')
    const upnpWorking = capabilities.upnp && upnpStatus.available && upnpStatus.totalMappings > 0
    const externalConnectivity = externalAddresses.length > 0 || connectionInfo.canAcceptDirectConnections
    
    console.log(`   UPnP Working: ${upnpWorking ? '✅ PASS' : '❌ FAIL'}`)
    console.log(`   External Connectivity: ${externalConnectivity ? '✅ PASS' : '❌ FAIL'}`)
    console.log(`   Direct Connections: ${connectionInfo.canAcceptDirectConnections ? '✅ PASS' : '❌ FAIL'}`)

    if (upnpWorking && externalConnectivity) {
      console.log('\n🎉 UPnP is fully working! Your node can accept direct connections.')
    } else {
      console.log('\n⚠️  UPnP may not be fully working. Check your router settings.')
    }

    // Keep running for a bit to see ongoing status
    console.log('\n⏱️  Monitoring for 30 seconds...')
    await new Promise(resolve => setTimeout(resolve, 30000))

  } catch (error) {
    console.error('❌ Test failed:', error)
  } finally {
    console.log('\n🧹 Cleaning up...')
    await node.stop()
    console.log('✅ Test completed')
  }
}

// Run the test
testUPnPFunctionality().catch(console.error)
