/**
 * Local Connection Test
 * 
 * Test two SimpleDIGNodes on the same machine to verify:
 * 1. LibP2P connectivity works
 * 2. DIG peer discovery works
 * 3. Store synchronization works
 * 
 * Once this works locally, we know the protocol is correct
 * and can extend to cross-network.
 */

import { SimpleDIGNode } from '../src/node2/SimpleDIGNode.js'

async function localConnectionTest() {
  console.log('🧪 Local Connection Test - Proving the Protocol Works')
  console.log('=====================================================')
  console.log('')

  // Create two nodes with different stores
  const node1 = new SimpleDIGNode(5001) // Local node with 49 stores
  const node2 = new SimpleDIGNode(5002) // Test node with 5 stores (simulating remote)

  try {
    console.log('🚀 Starting Node 1 (49 stores)...')
    await node1.start()
    
    console.log('🚀 Starting Node 2 (5 stores)...')
    await node2.start()

    // Wait for LibP2P network connection
    console.log('\n⏱️ Waiting for LibP2P network connection (45 seconds)...')
    await new Promise(resolve => setTimeout(resolve, 45000))

    // Check initial status
    const status1 = node1.getStatus()
    const status2 = node2.getStatus()

    console.log('\n📊 Initial Status:')
    console.log(`Node 1: ${status1.connectedPeers} peers, ${status1.digPeers} DIG peers, ${status1.storeCount} stores`)
    console.log(`Node 2: ${status2.connectedPeers} peers, ${status2.digPeers} DIG peers, ${status2.storeCount} stores`)

    // Force sync attempts
    console.log('\n🔄 Force triggering sync on both nodes...')
    await node1.syncNow()
    await node2.syncNow()

    // Check if they found each other
    const digPeers1 = node1.getDIGPeers()
    const digPeers2 = node2.getDIGPeers()

    console.log('\n🔍 DIG Peer Discovery Results:')
    console.log(`Node 1 found: ${digPeers1.length} DIG peers`)
    console.log(`Node 2 found: ${digPeers2.length} DIG peers`)

    if (digPeers1.length > 0 || digPeers2.length > 0) {
      console.log('🎉 DIG PEER DISCOVERY WORKING!')
      
      // Show discovered peers
      if (digPeers1.length > 0) {
        console.log('Node 1 discovered:')
        for (const peer of digPeers1) {
          console.log(`  🔗 ${peer.peerId.substring(0, 20)}... (${peer.stores.length} stores)`)
        }
      }
      
      if (digPeers2.length > 0) {
        console.log('Node 2 discovered:')
        for (const peer of digPeers2) {
          console.log(`  🔗 ${peer.peerId.substring(0, 20)}... (${peer.stores.length} stores)`)
        }
      }

      // Monitor for store sync
      console.log('\n⏱️ Monitoring for store synchronization (60 seconds)...')
      for (let i = 0; i < 6; i++) {
        await new Promise(resolve => setTimeout(resolve, 10000))
        
        const currentStatus1 = node1.getStatus()
        const currentStatus2 = node2.getStatus()
        
        console.log(`[${(i + 1) * 10}s] Node1: ${currentStatus1.storeCount} stores | Node2: ${currentStatus2.storeCount} stores`)
        
        // Check if sync happened
        if (currentStatus1.storeCount !== status1.storeCount || currentStatus2.storeCount !== status2.storeCount) {
          console.log('🎉 STORE SYNC DETECTED!')
          break
        }
        
        // Trigger sync again
        if (i % 2 === 0) {
          console.log('🔄 Re-triggering sync...')
          await node1.syncNow()
          await node2.syncNow()
        }
      }

      // Final status
      const finalStatus1 = node1.getStatus()
      const finalStatus2 = node2.getStatus()
      
      console.log('\n📊 Final Results:')
      console.log(`Node 1: ${finalStatus1.storeCount} stores (started with ${status1.storeCount})`)
      console.log(`Node 2: ${finalStatus2.storeCount} stores (started with ${status2.storeCount})`)
      
      if (finalStatus1.storeCount > status1.storeCount || finalStatus2.storeCount > status2.storeCount) {
        console.log('🎉 SUCCESS: Store synchronization WORKING!')
      } else {
        console.log('⚠️ Store sync not detected - debugging needed')
      }

    } else {
      console.log('❌ DIG peer discovery failed - nodes cannot find each other')
      console.log('🔍 Debugging connection issues...')
      
      // Debug LibP2P connections
      console.log('\nNode 1 LibP2P peers:')
      const peers1 = status1.connectedPeers
      console.log(`  Connected to ${peers1} LibP2P peers`)
      
      console.log('\nNode 2 LibP2P peers:')
      const peers2 = status2.connectedPeers
      console.log(`  Connected to ${peers2} LibP2P peers`)
    }

  } catch (error) {
    console.error('❌ Local connection test failed:', error)
  } finally {
    console.log('\n🛑 Stopping test nodes...')
    await node1.stop()
    await node2.stop()
    console.log('✅ Local connection test completed')
  }
}

localConnectionTest().catch(console.error)
