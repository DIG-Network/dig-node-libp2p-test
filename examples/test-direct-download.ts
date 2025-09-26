/**
 * Test Direct HTTP Download from TURN-Capable Peers
 * 
 * Tests the new direct HTTP download functionality that bypasses
 * LibP2P connection issues by connecting directly to TURN-capable
 * peers via their external IP addresses.
 */

import { DIGNode } from '../src/node/DIGNode.js'

async function testDirectDownload() {
  console.log('📡 Testing Direct HTTP Download from TURN-Capable Peers')
  console.log('====================================================')

  // Set up environment for AWS bootstrap
  process.env.DIG_AWS_BOOTSTRAP_ENABLED = 'true'
  process.env.DIG_USER_TIER = 'standard'

  const node = new DIGNode({
    port: 4005, // Use different port
    enableMdns: true,
    enableDht: true,
    enableTurnServer: true
  })

  try {
    await node.start()

    console.log('\n📊 Node Started:')
    const info = node.getConnectionInfo()
    console.log(`   Peer ID: ${node.getStatus().peerId}`)
    console.log(`   Local Stores: ${node.getStatus().stores.length}`)
    console.log(`   TURN Capable: ${info.canActAsTurnServer}`)

    // Wait for initialization
    await new Promise(resolve => setTimeout(resolve, 15000))

    // Force AWS bootstrap registration
    console.log('\n🌐 Registering with AWS Bootstrap...')
    const registered = await node.useAWSBootstrapFallback()
    console.log(`   Registration: ${registered ? '✅ Success' : '❌ Failed'}`)

    if (registered) {
      // Get list of TURN-capable peers with stores
      console.log('\n🔍 Finding TURN-Capable Peers with Stores...')
      
      const response = await fetch('http://awseb--AWSEB-qNbAdipmcXyx-770761774.us-east-1.elb.amazonaws.com/peers?includeStores=true')
      const result = await response.json()
      
      const turnPeersWithStores = result.peers?.filter((peer: any) => 
        peer.turnCapable === true && 
        peer.stores?.length > 0 && 
        peer.peerId !== node.getStatus().peerId &&
        peer.turnAddresses?.length > 0
      ) || []

      console.log(`   Found ${turnPeersWithStores.length} TURN-capable peers with stores`)

      if (turnPeersWithStores.length > 0) {
        const targetPeer = turnPeersWithStores[0]
        console.log(`\n📡 Testing Direct HTTP Download from: ${targetPeer.peerId.substring(0,20)}...`)
        console.log(`   Peer has ${targetPeer.stores.length} stores`)
        console.log(`   TURN addresses: ${targetPeer.turnAddresses.length}`)

        if (targetPeer.stores.length > 0) {
          const testStoreId = targetPeer.stores[0]
          console.log(`\n📥 Attempting direct download of store: ${testStoreId}`)
          
          // Test the downloadViaDirectConnection method
          const downloaded = await node.downloadStore(testStoreId)
          console.log(`   Download result: ${downloaded ? '✅ Success' : '❌ Failed'}`)

          if (downloaded) {
            console.log(`   ✅ Store ${testStoreId} downloaded successfully!`)
            console.log(`   📁 Local stores now: ${node.getStatus().stores.length}`)
          }
        }
      } else {
        console.log('⚠️ No TURN-capable peers with stores found for testing')
      }
    }

    // Keep running briefly to monitor
    console.log('\n⏱️ Monitoring for 30 seconds...')
    await new Promise(resolve => setTimeout(resolve, 30000))

  } catch (error) {
    console.error('❌ Direct download test failed:', error)
  } finally {
    console.log('\n🛑 Stopping test...')
    await node.stop()
    console.log('✅ Test completed')
  }
}

testDirectDownload().catch(console.error)
