/**
 * Force Local Connection Test
 * 
 * Forces two local DIG nodes to connect to each other directly
 * and tests the DIG protocol handshake.
 */

import { SimpleDIGNode } from '../src/node2/SimpleDIGNode.js'

async function forceLocalConnection() {
  console.log('🔗 Force Local Connection Test')
  console.log('==============================')
  console.log('')

  const node1 = new SimpleDIGNode(13001)
  const node2 = new SimpleDIGNode(13002)

  try {
    console.log('🚀 Starting Node 1...')
    await node1.start()
    
    console.log('🚀 Starting Node 2...')  
    await node2.start()

    // Get their addresses
    const status1 = node1.getStatus()
    const status2 = node2.getStatus()

    console.log(`✅ Node 1: ${status1.storeCount} .dig files`)
    console.log(`✅ Node 2: ${status2.storeCount} .dig files`)
    console.log('')

    // Wait for nodes to stabilize
    console.log('⏱️ Waiting for nodes to stabilize (15 seconds)...')
    await new Promise(resolve => setTimeout(resolve, 15000))

    // Force Node 1 to connect to Node 2 using localhost address
    const node2LocalAddr = status2.listeningAddresses.find((addr: string) => addr.includes('127.0.0.1'))
    
    if (node2LocalAddr) {
      console.log(`🎯 Forcing connection: Node1 → Node2 (${node2LocalAddr})`)
      
      try {
        await node1.connectToRemote(node2LocalAddr)
        console.log('✅ Forced connection completed!')
        
        // Wait for DIG protocol handshake
        console.log('⏱️ Waiting for DIG protocol handshake...')
        await new Promise(resolve => setTimeout(resolve, 10000))
        
        // Check if they found each other as DIG peers
        const digPeers1 = node1.getDIGPeers()
        const digPeers2 = node2.getDIGPeers()
        
        console.log('')
        console.log(`🔍 DIG Peer Discovery Results:`)
        console.log(`Node 1 found: ${digPeers1.length} DIG peers`)
        console.log(`Node 2 found: ${digPeers2.length} DIG peers`)
        
        if (digPeers1.length > 0) {
          console.log('🎉 SUCCESS: Node 1 found DIG peers!')
          for (const peer of digPeers1) {
            console.log(`  🔗 ${peer.peerId.substring(0, 20)}... (${peer.stores.length} stores)`)
          }
        }
        
        if (digPeers2.length > 0) {
          console.log('🎉 SUCCESS: Node 2 found DIG peers!')
          for (const peer of digPeers2) {
            console.log(`  🔗 ${peer.peerId.substring(0, 20)}... (${peer.stores.length} stores)`)
          }
        }
        
        if (digPeers1.length > 0 || digPeers2.length > 0) {
          console.log('')
          console.log('✅ DIG PROTOCOL HANDSHAKE WORKING!')
          console.log('✅ DIG PEER DISCOVERY WORKING!')
          
          // Test file sync
          console.log('')
          console.log('🔄 Testing file synchronization...')
          await node1.syncNow()
          await node2.syncNow()
          
          await new Promise(resolve => setTimeout(resolve, 10000))
          
          const finalStatus1 = node1.getStatus()
          const finalStatus2 = node2.getStatus()
          
          console.log(`📊 Final stores: Node1=${finalStatus1.storeCount}, Node2=${finalStatus2.storeCount}`)
          
          if (finalStatus1.storeCount === finalStatus2.storeCount) {
            console.log('✅ FILE SYNCHRONIZATION WORKING!')
            console.log('')
            console.log('🎉 COMPLETE SUCCESS!')
            console.log('🎉 DIG NETWORK FULLY FUNCTIONAL!')
          } else {
            console.log('⚠️ Store counts different - sync may need more time')
          }
          
        } else {
          console.log('')
          console.log('❌ DIG protocol handshake failed')
          console.log('🔍 Nodes connected via LibP2P but DIG protocol not recognized')
          
          // Debug LibP2P connections
          const libp2pPeers1 = (node1 as any).node.getPeers()
          const libp2pPeers2 = (node2 as any).node.getPeers()
          
          console.log('')
          console.log('🔍 Debug Info:')
          console.log(`LibP2P peers Node1: ${libp2pPeers1.length}`)
          console.log(`LibP2P peers Node2: ${libp2pPeers2.length}`)
          
          // Check if they're connected to each other
          const node1PeerId = (node1 as any).node.peerId.toString()
          const node2PeerId = (node2 as any).node.peerId.toString()
          
          const node1ConnectedToNode2 = libp2pPeers1.some((p: any) => p.toString() === node2PeerId)
          const node2ConnectedToNode1 = libp2pPeers2.some((p: any) => p.toString() === node1PeerId)
          
          console.log(`Node1 connected to Node2: ${node1ConnectedToNode2}`)
          console.log(`Node2 connected to Node1: ${node2ConnectedToNode1}`)
          
          if (node1ConnectedToNode2 || node2ConnectedToNode1) {
            console.log('🔍 Nodes ARE connected to each other - DIG protocol handler issue')
          } else {
            console.log('🔍 Nodes NOT connected to each other - connection issue')
          }
        }
        
      } catch (connectionError) {
        console.error('❌ Failed to force connection:', connectionError)
      }
      
    } else {
      console.log('❌ Could not find Node 2 localhost address')
    }

  } catch (error) {
    console.error('❌ Force local connection test failed:', error)
  } finally {
    console.log('\n🛑 Stopping test nodes...')
    await node1.stop()
    await node2.stop()
    console.log('✅ Force local connection test completed')
  }
}

forceLocalConnection().catch(console.error)
