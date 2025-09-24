/**
 * Manual DIG Peer Connection Helper
 * 
 * For hotel networks where automatic discovery fails.
 * This script helps you manually connect two DIG nodes on the same network.
 */

import { DIGNode } from '../src/node/DIGNode.js'

async function connectLocalDIGPeers() {
  console.log('🏨 Manual DIG Peer Connection Helper for Hotel Networks')
  console.log('====================================================')
  console.log('')

  // Get local IP addresses
  const { networkInterfaces } = await import('os')
  const interfaces = networkInterfaces()
  
  console.log('🔍 Available network interfaces:')
  for (const [name, addresses] of Object.entries(interfaces)) {
    if (!addresses) continue
    
    for (const addr of addresses) {
      if (addr.family === 'IPv4' && !addr.internal) {
        console.log(`   ${name}: ${addr.address}`)
      }
    }
  }
  console.log('')

  // Start DIG node
  console.log('🚀 Starting DIG node...')
  const node = new DIGNode({
    port: parseInt(process.env.DIG_PORT || '4001'),
    enableMdns: true,
    enableDht: true
  })

  try {
    await node.start()
    
    const status = node.getStatus()
    const connectionInfo = node.getConnectionInfo()
    
    console.log('✅ DIG Node started successfully!')
    console.log('')
    console.log('📊 Node Information:')
    console.log(`   🆔 Peer ID: ${status.peerId}`)
    console.log(`   🔐 Crypto-IPv6: ${status.cryptoIPv6}`)
    console.log(`   📁 Stores: ${status.stores.length}`)
    console.log('')
    console.log('🔗 Connection Addresses:')
    for (const addr of connectionInfo.listeningAddresses) {
      console.log(`   ${addr}`)
    }
    console.log('')
    console.log('🏨 Manual Connection Instructions:')
    console.log('=====================================')
    console.log('1. Share your Peer ID with the other DIG node user:')
    console.log(`   Peer ID: ${status.peerId}`)
    console.log('')
    console.log('2. Get their local IP address and try to connect:')
    console.log('   Example: await node.connectToLocalPeer("192.168.1.101", 4001)')
    console.log('')
    console.log('3. Or use full multiaddr:')
    console.log('   Example: await node.connectToPeer("/ip4/192.168.1.101/tcp/4001/p2p/THEIR_PEER_ID")')
    console.log('')

    // Monitor for connections
    setInterval(() => {
      const currentStatus = node.getNetworkHealth()
      const currentConnections = node.getConnectionInfo()
      
      console.log(`📊 Status Update:`)
      console.log(`   🔗 Connected Peers: ${currentStatus.connectedPeers}`)
      console.log(`   🎯 DIG Peers: ${currentStatus.digPeers}`)
      console.log(`   📁 Stores Available: ${currentStatus.storesShared}`)
      
      if (currentStatus.digPeers > 0) {
        console.log('   ✅ DIG peer(s) connected! Store sync should begin.')
      } else {
        console.log('   ⚠️ No DIG peers connected yet. Try manual connection.')
      }
      console.log('')
    }, 30000) // Every 30 seconds

    // Graceful shutdown
    process.on('SIGINT', async () => {
      console.log('\n🛑 Shutting down...')
      await node.stop()
      process.exit(0)
    })

  } catch (error) {
    console.error('❌ Failed to start DIG node:', error)
    process.exit(1)
  }
}

// Helper function to connect to specific peer
async function connectToPeerManually(node: DIGNode, targetIP: string, targetPort: number = 4001) {
  try {
    console.log(`🔗 Attempting manual connection to ${targetIP}:${targetPort}...`)
    
    const success = await node.connectToLocalPeer(targetIP, targetPort)
    
    if (success) {
      console.log(`✅ Successfully connected to DIG peer at ${targetIP}:${targetPort}`)
    } else {
      console.log(`❌ Failed to connect to ${targetIP}:${targetPort} (not a DIG peer or unreachable)`)
    }
    
    return success
  } catch (error) {
    console.error(`❌ Connection error: ${error}`)
    return false
  }
}

// Run the helper
connectLocalDIGPeers().catch(console.error)

// Export for programmatic use
export { connectToPeerManually }
