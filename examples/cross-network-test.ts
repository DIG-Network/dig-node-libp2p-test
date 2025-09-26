/**
 * Cross-Network DIG Node Test
 * 
 * Tests DIG nodes connecting across different networks using AWS bootstrap fallback.
 * Forces AWS bootstrap registration regardless of LibP2P peer count.
 */

import { DIGNode } from '../src/node/DIGNode.js'

// Force AWS bootstrap fallback
process.env.DIG_AWS_BOOTSTRAP_ENABLED = 'true'
process.env.DIG_AWS_BOOTSTRAP_URL = 'http://awseb--AWSEB-qNbAdipmcXyx-770761774.us-east-1.elb.amazonaws.com'
process.env.DIG_USER_TIER = 'standard'
process.env.DIG_IS_PREMIUM = 'false'

async function startCrossNetworkTest() {
  console.log('🌐 Starting Cross-Network DIG Node Test')
  console.log('=====================================')

  const node = new DIGNode({
    port: 4003, // Use different port to avoid conflicts
    enableMdns: true,
    enableDht: true,
    enableTurnServer: true
  })

  try {
    await node.start()

    console.log('\n📊 DIG Node Started:')
    const connectionInfo = node.getConnectionInfo()
    console.log(`   Peer ID: ${connectionInfo.connectedPeers[0] || 'Unknown'}`)
    console.log(`   Connected Peers: ${connectionInfo.peerCount}`)
    console.log(`   DIG Peers: ${connectionInfo.digPeers}`)

    // Force AWS bootstrap registration immediately
    console.log('\n🌐 Forcing AWS Bootstrap Registration...')
    const registered = await node.useAWSBootstrapFallback()
    console.log(`   AWS Registration: ${registered ? '✅ Success' : '❌ Failed'}`)

    if (registered) {
      // Force peer discovery from AWS bootstrap
      console.log('\n🔍 Discovering Peers from AWS Bootstrap...')
      await node.discoverPeersFromAWSBootstrap()
      
      // Wait a bit and check connections
      await new Promise(resolve => setTimeout(resolve, 10000))
      
      const updatedInfo = node.getConnectionInfo()
      console.log(`\n📊 After AWS Bootstrap Discovery:`)
      console.log(`   Total Peers: ${updatedInfo.peerCount}`)
      console.log(`   DIG Peers: ${updatedInfo.digPeers}`)
      
      // Try to trigger manual peer discovery
      console.log('\n🔍 Triggering Manual Peer Discovery...')
      await node.discoverAllPeers()
    }

    // Monitor for connections
    console.log('\n⏱️  Monitoring for 60 seconds...')
    const startTime = Date.now()
    
    setInterval(() => {
      const info = node.getConnectionInfo()
      const elapsed = Math.round((Date.now() - startTime) / 1000)
      console.log(`[${elapsed}s] 📊 Peers: ${info.peerCount} total, ${info.digPeers} DIG`)
    }, 10000)

    // Keep running for monitoring
    await new Promise(resolve => setTimeout(resolve, 60000))

  } catch (error) {
    console.error('❌ Cross-network test failed:', error)
  } finally {
    console.log('\n🛑 Stopping test...')
    await node.stop()
  }
}

startCrossNetworkTest().catch(console.error)
