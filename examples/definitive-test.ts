/**
 * DEFINITIVE TEST
 * 
 * This test will definitively prove whether the DIG protocol works
 * by forcing two nodes to connect directly and testing the handshake.
 */

import { SimpleDIGNode } from '../src/node2/SimpleDIGNode.js'

async function definitiveTest() {
  console.log('🎯 DEFINITIVE DIG PROTOCOL TEST')
  console.log('===============================')
  console.log('')

  const node1 = new SimpleDIGNode(15001)
  const node2 = new SimpleDIGNode(15002)

  try {
    console.log('🚀 Starting both nodes...')
    await node1.start()
    await node2.start()

    console.log(`✅ Node 1: ${node1.getStatus().storeCount} .dig files`)
    console.log(`✅ Node 2: ${node2.getStatus().storeCount} .dig files`)
    
    // Get their peer IDs and addresses
    const node1PeerId = (node1 as any).node.peerId.toString()
    const node2PeerId = (node2 as any).node.peerId.toString()
    const node1Addrs = node1.getStatus().listeningAddresses
    const node2Addrs = node2.getStatus().listeningAddresses
    
    console.log('')
    console.log(`📍 Node 1 ID: ${node1PeerId}`)
    console.log(`📍 Node 2 ID: ${node2PeerId}`)
    console.log('')

    // Wait for nodes to stabilize
    console.log('⏱️ Waiting for nodes to stabilize...')
    await new Promise(resolve => setTimeout(resolve, 10000))

    // FORCE Node 1 to connect to Node 2 using localhost address
    const node2LocalAddr = node2Addrs.find((addr: string) => addr.includes('127.0.0.1'))
    
    if (node2LocalAddr) {
      console.log(`🔗 FORCING connection: Node1 → Node2`)
      console.log(`🎯 Target address: ${node2LocalAddr}`)
      
      await node1.connectToRemote(node2LocalAddr)
      
      // Wait for connection to establish
      await new Promise(resolve => setTimeout(resolve, 5000))
      
      // Check LibP2P connection
      const libp2pPeers1 = (node1 as any).node.getPeers()
      const libp2pPeers2 = (node2 as any).node.getPeers()
      
      const node1ConnectedToNode2 = libp2pPeers1.some((p: any) => p.toString() === node2PeerId)
      const node2ConnectedToNode1 = libp2pPeers2.some((p: any) => p.toString() === node1PeerId)
      
      console.log('')
      console.log('🔍 LibP2P Connection Status:')
      console.log(`Node1 → Node2: ${node1ConnectedToNode2}`)
      console.log(`Node2 → Node1: ${node2ConnectedToNode1}`)
      
      if (node1ConnectedToNode2 || node2ConnectedToNode1) {
        console.log('✅ LibP2P connection established!')
        
        // Wait for DIG protocol testing
        console.log('')
        console.log('⏱️ Waiting for DIG protocol handshake...')
        await new Promise(resolve => setTimeout(resolve, 10000))
        
        const digPeers1 = node1.getDIGPeers()
        const digPeers2 = node2.getDIGPeers()
        
        console.log('')
        console.log('🔍 DIG Protocol Results:')
        console.log(`Node 1 DIG peers: ${digPeers1.length}`)
        console.log(`Node 2 DIG peers: ${digPeers2.length}`)
        
        if (digPeers1.length > 0 || digPeers2.length > 0) {
          console.log('')
          console.log('🎉 SUCCESS: DIG PROTOCOL HANDSHAKE WORKING!')
          console.log('🎉 SUCCESS: DIG PEER DISCOVERY WORKING!')
          console.log('')
          
          // Test file sync
          console.log('🔄 Testing file synchronization...')
          await node1.syncNow()
          await node2.syncNow()
          
          await new Promise(resolve => setTimeout(resolve, 15000))
          
          const finalStatus1 = node1.getStatus()
          const finalStatus2 = node2.getStatus()
          
          console.log(`📊 Final stores: Node1=${finalStatus1.storeCount}, Node2=${finalStatus2.storeCount}`)
          
          if (finalStatus1.storeCount === finalStatus2.storeCount) {
            console.log('')
            console.log('🎉 COMPLETE SUCCESS!')
            console.log('✅ LibP2P connections work')
            console.log('✅ DIG protocol handshake works')
            console.log('✅ DIG peer discovery works')
            console.log('✅ File synchronization works')
            console.log('')
            console.log('🌍 READY FOR REMOTE NODE CONNECTION!')
          }
          
        } else {
          console.log('')
          console.log('❌ DIG PROTOCOL HANDSHAKE FAILED')
          console.log('🔍 LibP2P connection exists but DIG protocol not working')
          console.log('🔍 This indicates an issue with the DIG protocol handler')
        }
        
      } else {
        console.log('❌ LibP2P connection failed')
        console.log('🔍 Manual connection attempt did not establish LibP2P connection')
      }
      
    } else {
      console.log('❌ Could not find Node 2 localhost address')
    }

  } catch (error) {
    console.error('❌ Definitive test failed:', error)
  } finally {
    console.log('\n🛑 Stopping test nodes...')
    await node1.stop()
    await node2.stop()
    console.log('✅ Definitive test completed')
  }
}

definitiveTest().catch(console.error)
