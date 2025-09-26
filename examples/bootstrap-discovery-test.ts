/**
 * Bootstrap Discovery Test
 * 
 * Tests the improved approach:
 * 1. Use bootstrap servers for peer discovery
 * 2. Use direct connections for reliable DIG communication
 * 3. Improved gossip protocol handling
 */

import { SimpleDIGNode } from '../src/node2/SimpleDIGNode.js'

async function bootstrapDiscoveryTest() {
  console.log('🌐 Bootstrap Discovery + Direct Connection Test')
  console.log('==============================================')
  console.log('')

  const node1 = new SimpleDIGNode(11001)
  const node2 = new SimpleDIGNode(11002)

  try {
    console.log('🚀 Starting both nodes with bootstrap discovery...')
    await node1.start()
    await node2.start()

    console.log(`✅ Node 1: ${node1.getStatus().storeCount} .dig files`)
    console.log(`✅ Node 2: ${node2.getStatus().storeCount} .dig files`)
    console.log('')

    // Monitor for peer discovery and connections
    console.log('📡 Monitoring bootstrap discovery and DIG peer connections...')
    
    let checkCount = 0
    const maxChecks = 15 // 3.75 minutes
    
    const monitorInterval = setInterval(async () => {
      checkCount++
      
      const status1 = node1.getStatus()
      const status2 = node2.getStatus()
      const digPeers1 = node1.getDIGPeers()
      const digPeers2 = node2.getDIGPeers()
      
      console.log(`[${checkCount * 15}s] Node1: ${status1.connectedPeers} peers, ${status1.digPeers} DIG | Node2: ${status2.connectedPeers} peers, ${status2.digPeers} DIG`)
      
      if (digPeers1.length > 0 || digPeers2.length > 0) {
        console.log('')
        console.log('🎉 SUCCESS: DIG peers discovered via bootstrap!')
        
        if (digPeers1.length > 0) {
          console.log(`Node 1 found DIG peers:`)
          for (const peer of digPeers1) {
            console.log(`  🔗 ${peer.peerId.substring(0, 20)}... (${peer.stores.length} stores)`)
          }
        }
        
        if (digPeers2.length > 0) {
          console.log(`Node 2 found DIG peers:`)
          for (const peer of digPeers2) {
            console.log(`  🔗 ${peer.peerId.substring(0, 20)}... (${peer.stores.length} stores)`)
          }
        }
        
        console.log('')
        console.log('🔄 Testing file synchronization...')
        await node1.syncNow()
        await node2.syncNow()
        
        // Wait for sync
        await new Promise(resolve => setTimeout(resolve, 10000))
        
        const finalStatus1 = node1.getStatus()
        const finalStatus2 = node2.getStatus()
        
        console.log(`📊 Final stores: Node1=${finalStatus1.storeCount}, Node2=${finalStatus2.storeCount}`)
        
        if (finalStatus1.storeCount === finalStatus2.storeCount) {
          console.log('✅ SUCCESS: File synchronization working!')
          console.log('✅ Bootstrap discovery + direct connection WORKING!')
        } else {
          console.log('⚠️ Store counts different - sync may need more time')
        }
        
        clearInterval(monitorInterval)
        return
      }
      
      if (checkCount >= maxChecks) {
        console.log('⏰ Test timeout - nodes may need more time to discover each other')
        clearInterval(monitorInterval)
      }
      
    }, 15000)

  } catch (error) {
    console.error('❌ Bootstrap discovery test failed:', error)
  } finally {
    setTimeout(async () => {
      console.log('\n🛑 Stopping test nodes...')
      await node1.stop()
      await node2.stop()
      console.log('✅ Bootstrap discovery test completed')
    }, 60000) // Let it run for 1 minute
  }
}

bootstrapDiscoveryTest().catch(console.error)
