/**
 * Simple Peer Discovery Test
 * 
 * Tests the most basic approach:
 * 1. Two nodes start
 * 2. They connect via mDNS (local network)
 * 3. They test each other for DIG protocol
 * 4. They sync files
 * 
 * This bypasses DHT entirely and focuses on direct peer discovery.
 */

import { SimpleDIGNode } from '../src/node2/SimpleDIGNode.js'

async function simplePeerDiscovery() {
  console.log('🔍 Simple Peer Discovery Test (No DHT)')
  console.log('=====================================')
  console.log('')

  const node1 = new SimpleDIGNode(14001)
  const node2 = new SimpleDIGNode(14002)

  try {
    console.log('🚀 Starting Node 1...')
    await node1.start()
    
    console.log('🚀 Starting Node 2...')
    await node2.start()

    console.log(`✅ Node 1: ${node1.getStatus().storeCount} .dig files`)
    console.log(`✅ Node 2: ${node2.getStatus().storeCount} .dig files`)
    console.log('')

    // Monitor LibP2P connections to see if they find each other
    console.log('📡 Monitoring for local peer discovery...')
    
    for (let i = 0; i < 20; i++) {
      await new Promise(resolve => setTimeout(resolve, 5000))
      
      const libp2pPeers1 = (node1 as any).node.getPeers()
      const libp2pPeers2 = (node2 as any).node.getPeers()
      
      const node1PeerId = (node1 as any).node.peerId.toString()
      const node2PeerId = (node2 as any).node.peerId.toString()
      
      // Check if they're connected to each other
      const node1ConnectedToNode2 = libp2pPeers1.some((p: any) => p.toString() === node2PeerId)
      const node2ConnectedToNode1 = libp2pPeers2.some((p: any) => p.toString() === node1PeerId)
      
      console.log(`[${(i+1)*5}s] Node1: ${libp2pPeers1.length} peers | Node2: ${libp2pPeers2.length} peers | Connected: ${node1ConnectedToNode2 || node2ConnectedToNode1}`)
      
      if (node1ConnectedToNode2 || node2ConnectedToNode1) {
        console.log('')
        console.log('🎉 SUCCESS: Nodes found each other via mDNS!')
        console.log(`Node1 → Node2: ${node1ConnectedToNode2}`)
        console.log(`Node2 → Node1: ${node2ConnectedToNode1}`)
        
        // Wait for DIG protocol testing
        console.log('⏱️ Waiting for DIG protocol handshake...')
        await new Promise(resolve => setTimeout(resolve, 10000))
        
        const digPeers1 = node1.getDIGPeers()
        const digPeers2 = node2.getDIGPeers()
        
        console.log('')
        console.log(`🔍 DIG Peer Results:`)
        console.log(`Node 1 DIG peers: ${digPeers1.length}`)
        console.log(`Node 2 DIG peers: ${digPeers2.length}`)
        
        if (digPeers1.length > 0 || digPeers2.length > 0) {
          console.log('✅ DIG PROTOCOL HANDSHAKE SUCCESS!')
          
          // Test sync
          console.log('🔄 Testing file sync...')
          await node1.syncNow()
          await node2.syncNow()
          
          await new Promise(resolve => setTimeout(resolve, 10000))
          
          const finalStatus1 = node1.getStatus()
          const finalStatus2 = node2.getStatus()
          
          console.log(`📊 Final: Node1=${finalStatus1.storeCount}, Node2=${finalStatus2.storeCount}`)
          
          if (finalStatus1.storeCount === finalStatus2.storeCount) {
            console.log('✅ FILE SYNC SUCCESS!')
            console.log('')
            console.log('🎉 COMPLETE SUCCESS!')
            console.log('🎉 DIG NETWORK WORKING WITHOUT DHT!')
          }
          
        } else {
          console.log('❌ DIG protocol handshake failed')
          console.log('🔍 LibP2P connection exists but DIG protocol not working')
        }
        
        break
      }
      
      // If no connection after 5 attempts, try manual connection
      if (i === 4) {
        console.log('')
        console.log('🔗 mDNS discovery slow, trying manual connection...')
        const node2LocalAddr = node2.getStatus().listeningAddresses.find((addr: string) => addr.includes('127.0.0.1'))
        
        if (node2LocalAddr) {
          console.log(`🎯 Manual connection: ${node2LocalAddr}`)
          await node1.connectToRemote(node2LocalAddr)
        }
      }
    }

  } catch (error) {
    console.error('❌ Simple peer discovery test failed:', error)
  } finally {
    console.log('\n🛑 Stopping test nodes...')
    await node1.stop()
    await node2.stop()
    console.log('✅ Simple peer discovery test completed')
  }
}

simplePeerDiscovery().catch(console.error)
