/**
 * Local Peer Discovery Test
 * 
 * Forces two local nodes to discover and connect to each other
 * using mDNS and manual connection.
 */

import { SimpleDIGNode } from '../src/node2/SimpleDIGNode.js'

async function localPeerDiscoveryTest() {
  console.log('🏠 Local Peer Discovery Test')
  console.log('============================')
  console.log('')

  const node1 = new SimpleDIGNode(12001)
  const node2 = new SimpleDIGNode(12002)

  try {
    console.log('🚀 Starting Node 1...')
    await node1.start()
    
    console.log('🚀 Starting Node 2...')
    await node2.start()

    const status1 = node1.getStatus()
    const status2 = node2.getStatus()

    console.log(`✅ Node 1: ${status1.storeCount} .dig files`)
    console.log(`✅ Node 2: ${status2.storeCount} .dig files`)
    console.log('')

    // Wait for mDNS discovery
    console.log('⏱️ Waiting for mDNS local network discovery...')
    await new Promise(resolve => setTimeout(resolve, 30000))

    // Check if they discovered each other
    let libp2pPeers1 = (node1 as any).node.getPeers().length
    let libp2pPeers2 = (node2 as any).node.getPeers().length

    console.log(`📊 After mDNS: Node1=${libp2pPeers1} peers, Node2=${libp2pPeers2} peers`)

    // If they didn't discover each other via mDNS, force connection
    if (libp2pPeers1 === 0 || libp2pPeers2 === 0) {
      console.log('🔗 mDNS discovery failed, forcing direct connection...')
      
      const node2LocalAddr = status2.listeningAddresses.find((addr: string) => addr.includes('127.0.0.1'))
      if (node2LocalAddr) {
        console.log(`🎯 Node1 connecting to Node2: ${node2LocalAddr}`)
        await node1.connectToRemote(node2LocalAddr)
        
        // Wait for connection to establish
        await new Promise(resolve => setTimeout(resolve, 5000))
        
        libp2pPeers1 = (node1 as any).node.getPeers().length
        libp2pPeers2 = (node2 as any).node.getPeers().length
        
        console.log(`📊 After direct connection: Node1=${libp2pPeers1} peers, Node2=${libp2pPeers2} peers`)
      }
    }

    // Now check for DIG peer discovery
    let attempts = 0
    const maxAttempts = 10
    
    while (attempts < maxAttempts) {
      const digPeers1 = node1.getDIGPeers()
      const digPeers2 = node2.getDIGPeers()
      
      console.log(`[Attempt ${attempts + 1}] DIG peers: Node1=${digPeers1.length}, Node2=${digPeers2.length}`)
      
      if (digPeers1.length > 0 || digPeers2.length > 0) {
        console.log('')
        console.log('🎉 SUCCESS: Nodes found each other as DIG peers!')
        
        // Test sync
        console.log('🔄 Testing file synchronization...')
        await node1.syncNow()
        await node2.syncNow()
        
        await new Promise(resolve => setTimeout(resolve, 10000))
        
        const finalStatus1 = node1.getStatus()
        const finalStatus2 = node2.getStatus()
        
        console.log(`📊 Final stores: Node1=${finalStatus1.storeCount}, Node2=${finalStatus2.storeCount}`)
        
        if (finalStatus1.storeCount === finalStatus2.storeCount) {
          console.log('✅ SUCCESS: File synchronization working!')
          console.log('✅ Local peer discovery COMPLETE!')
        }
        
        break
      }
      
      attempts++
      await new Promise(resolve => setTimeout(resolve, 5000))
    }
    
    if (attempts >= maxAttempts) {
      console.log('❌ DIG peer discovery failed - nodes connected via LibP2P but DIG protocol not working')
      
      // Debug info
      const finalLibp2pPeers1 = (node1 as any).node.getPeers().length
      const finalLibp2pPeers2 = (node2 as any).node.getPeers().length
      
      console.log(`🔍 Final LibP2P peers: Node1=${finalLibp2pPeers1}, Node2=${finalLibp2pPeers2}`)
      console.log('🔍 Issue: LibP2P connection exists but DIG protocol handshake failing')
    }

  } catch (error) {
    console.error('❌ Local peer discovery test failed:', error)
  } finally {
    console.log('\n🛑 Stopping test nodes...')
    await node1.stop()
    await node2.stop()
    console.log('✅ Local peer discovery test completed')
  }
}

localPeerDiscoveryTest().catch(console.error)
