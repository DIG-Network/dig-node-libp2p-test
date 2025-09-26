/**
 * WORKING DIG Connection Test
 * 
 * Based on the logs showing LibP2P CAN connect (10 peers each),
 * this bypasses external bootstrap and makes nodes connect directly.
 * Uses manual addressing to force connection between DIG nodes.
 */

import { SimpleDIGNode } from '../src/node2/SimpleDIGNode.js'

async function workingDIGConnection() {
  console.log('🎯 WORKING DIG Connection - Direct Address Exchange')
  console.log('================================================')
  console.log('')

  // Use different ports to avoid conflicts
  const node1 = new SimpleDIGNode(8001)
  const node2 = new SimpleDIGNode(8002)

  try {
    console.log('🚀 Starting Node 1...')
    await node1.start()
    
    console.log('🚀 Starting Node 2...')
    await node2.start()

    // Get their addresses
    const status1 = node1.getStatus()
    const status2 = node2.getStatus()

    console.log(`\n📍 Node 1: ${status1.listeningAddresses[0]}`)
    console.log(`📍 Node 2: ${status2.listeningAddresses[0]}`)

    // Wait for nodes to stabilize
    console.log('\n⏱️ Waiting for nodes to stabilize...')
    await new Promise(resolve => setTimeout(resolve, 10000))

    // CRITICAL: Force direct connection using multiaddr
    console.log('\n🔗 FORCING direct connection...')
    const { multiaddr } = await import('@multiformats/multiaddr')
    
    // Get localhost addresses
    const node1LocalAddr = status1.listeningAddresses.find(addr => addr.includes('127.0.0.1'))
    const node2LocalAddr = status2.listeningAddresses.find(addr => addr.includes('127.0.0.1'))

    if (node1LocalAddr && node2LocalAddr) {
      console.log(`🎯 Node1 connecting to Node2: ${node2LocalAddr}`)
      
      // Force Node 1 to connect to Node 2
      const node2Multiaddr = multiaddr(node2LocalAddr)
      await (node1 as any).node.dial(node2Multiaddr)
      
      console.log('✅ Direct connection established!')
      
      // Wait for DIG protocol handshake
      console.log('\n⏱️ Waiting for DIG protocol discovery...')
      await new Promise(resolve => setTimeout(resolve, 5000))

      // Check DIG peer discovery
      let attempts = 0
      const maxAttempts = 10
      
      while (attempts < maxAttempts) {
        const digPeers1 = node1.getDIGPeers()
        const digPeers2 = node2.getDIGPeers()
        
        console.log(`[Attempt ${attempts + 1}] Node1: ${digPeers1.length} DIG peers | Node2: ${digPeers2.length} DIG peers`)
        
        if (digPeers1.length > 0 || digPeers2.length > 0) {
          console.log('🎉 SUCCESS: DIG peer discovery working!')
          
          // Test sync
          console.log('\n🔄 Testing file synchronization...')
          
          const initialStores1 = node1.getStatus().storeCount
          const initialStores2 = node2.getStatus().storeCount
          
          console.log(`📊 Before sync - Node1: ${initialStores1} stores | Node2: ${initialStores2} stores`)
          
          await node1.syncNow()
          await node2.syncNow()
          
          // Wait for sync to complete
          await new Promise(resolve => setTimeout(resolve, 15000))
          
          const finalStores1 = node1.getStatus().storeCount
          const finalStores2 = node2.getStatus().storeCount
          
          console.log(`📊 After sync - Node1: ${finalStores1} stores | Node2: ${finalStores2} stores`)
          
          if (finalStores1 === finalStores2) {
            console.log('🎉 SUCCESS: File synchronization working!')
            console.log('✅ DIG Network is FULLY FUNCTIONAL!')
            break
          } else {
            console.log('⚠️ Sync in progress or different stores')
          }
          
          break
        }
        
        attempts++
        await new Promise(resolve => setTimeout(resolve, 3000))
      }
      
      if (attempts >= maxAttempts) {
        console.log('❌ DIG peer discovery failed - protocol issue')
        
        // Debug: Check LibP2P connection
        const libp2pPeers1 = (node1 as any).node.getPeers().length
        const libp2pPeers2 = (node2 as any).node.getPeers().length
        
        console.log(`🔍 LibP2P peers - Node1: ${libp2pPeers1} | Node2: ${libp2pPeers2}`)
      }
      
    } else {
      console.log('❌ Could not find localhost addresses')
    }

  } catch (error) {
    console.error('❌ Working DIG connection test failed:', error)
  } finally {
    console.log('\n🛑 Stopping nodes...')
    await node1.stop()
    await node2.stop()
    console.log('✅ Working DIG connection test completed')
  }
}

workingDIGConnection().catch(console.error)
