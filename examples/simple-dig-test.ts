/**
 * Simple DIG Network Test
 * 
 * Tests the clean, minimal DIG implementation:
 * - Basic LibP2P connectivity
 * - DIG peer discovery
 * - .dig file synchronization
 * - Uses public infrastructure only
 */

import { SimpleDIGNode } from '../src/node2/SimpleDIGNode.js'

async function simpleDIGTest() {
  console.log('🧪 Simple DIG Network Test')
  console.log('==========================')
  console.log('')

  // Create two nodes on different ports
  const node1 = new SimpleDIGNode(4001)
  const node2 = new SimpleDIGNode(4002)

  try {
    console.log('🚀 Starting Node 1...')
    await node1.start()
    
    console.log('\n🚀 Starting Node 2...')
    await node2.start()

    // Wait for nodes to connect to LibP2P network
    console.log('\n⏱️ Waiting for LibP2P network connectivity (30 seconds)...')
    await new Promise(resolve => setTimeout(resolve, 30000))

    // Check status
    const status1 = node1.getStatus()
    const status2 = node2.getStatus()

    console.log('\n📊 Node Status:')
    console.log(`Node 1: ${status1.connectedPeers} peers, ${status1.storeCount} stores, ${status1.digPeers} DIG peers`)
    console.log(`Node 2: ${status2.connectedPeers} peers, ${status2.storeCount} stores, ${status2.digPeers} DIG peers`)

    // Test peer discovery
    console.log('\n🔍 Testing DIG Peer Discovery...')
    const digPeers1 = node1.getDIGPeers()
    const digPeers2 = node2.getDIGPeers()

    console.log(`Node 1 found ${digPeers1.length} DIG peers`)
    console.log(`Node 2 found ${digPeers2.length} DIG peers`)

    if (digPeers1.length > 0 || digPeers2.length > 0) {
      console.log('✅ DIG peer discovery working!')
      
      // Test manual sync
      console.log('\n🔄 Testing manual store sync...')
      await node1.syncNow()
      await node2.syncNow()
      
      // Check final store counts
      const finalStatus1 = node1.getStatus()
      const finalStatus2 = node2.getStatus()
      
      console.log('\n📊 Final Store Counts:')
      console.log(`Node 1: ${finalStatus1.storeCount} stores`)
      console.log(`Node 2: ${finalStatus2.storeCount} stores`)
      
      if (finalStatus1.storeCount > status1.storeCount || finalStatus2.storeCount > status2.storeCount) {
        console.log('🎉 Store synchronization working!')
      }
    } else {
      console.log('⚠️ No DIG peers discovered yet - may need more time')
    }

    // Monitor for additional time
    console.log('\n⏱️ Monitoring for 60 seconds...')
    for (let i = 0; i < 6; i++) {
      await new Promise(resolve => setTimeout(resolve, 10000))
      
      const currentStatus1 = node1.getStatus()
      const currentStatus2 = node2.getStatus()
      
      console.log(`[${(i + 1) * 10}s] Node1: ${currentStatus1.connectedPeers} peers, ${currentStatus1.digPeers} DIG | Node2: ${currentStatus2.connectedPeers} peers, ${currentStatus2.digPeers} DIG`)
    }

    console.log('\n📊 Simple DIG Test Results:')
    console.log('============================')
    console.log(`✅ LibP2P Connectivity: ${status1.connectedPeers > 0 || status2.connectedPeers > 0 ? 'Working' : 'Failed'}`)
    console.log(`✅ DIG Peer Discovery: ${digPeers1.length > 0 || digPeers2.length > 0 ? 'Working' : 'Failed'}`)
    console.log(`✅ Store Loading: ${status1.storeCount > 0 || status2.storeCount > 0 ? 'Working' : 'Failed'}`)

  } catch (error) {
    console.error('❌ Simple DIG test failed:', error)
  } finally {
    console.log('\n🛑 Stopping nodes...')
    await node1.stop()
    await node2.stop()
    console.log('✅ Simple DIG test completed')
  }
}

simpleDIGTest().catch(console.error)
