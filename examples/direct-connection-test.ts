/**
 * Direct Connection Test
 * 
 * Forces two SimpleDIGNodes to connect directly to each other
 * to test if the DIG protocol and file sync works when they
 * are actually connected.
 */

import { SimpleDIGNode } from '../src/node2/SimpleDIGNode.js'

async function directConnectionTest() {
  console.log('🎯 Direct Connection Test - Force Nodes to Connect')
  console.log('=================================================')
  console.log('')

  const node1 = new SimpleDIGNode(6001) // Different ports to avoid conflicts
  const node2 = new SimpleDIGNode(6002)

  try {
    console.log('🚀 Starting Node 1...')
    await node1.start()
    
    console.log('🚀 Starting Node 2...')
    await node2.start()

    // Get their addresses
    const status1 = node1.getStatus()
    const status2 = node2.getStatus()

    console.log(`\n📍 Node 1 addresses: ${status1.listeningAddresses.join(', ')}`)
    console.log(`📍 Node 2 addresses: ${status2.listeningAddresses.join(', ')}`)

    // Wait for LibP2P to stabilize
    console.log('\n⏱️ Waiting for LibP2P to stabilize (20 seconds)...')
    await new Promise(resolve => setTimeout(resolve, 20000))

    // Force direct connection - Node 1 connects to Node 2
    console.log('\n🔗 Forcing direct connection: Node 1 → Node 2')
    const node2Address = status2.listeningAddresses.find((addr: string) => addr.includes('127.0.0.1'))
    
    if (node2Address) {
      console.log(`🎯 Connecting to: ${node2Address}`)
      
      try {
        const { multiaddr } = await import('@multiformats/multiaddr')
        const addr = multiaddr(node2Address)
        await (node1 as any).node.dial(addr)
        console.log('✅ Direct connection established!')
        
        // Wait for DIG protocol testing
        await new Promise(resolve => setTimeout(resolve, 5000))
        
        // Check if they found each other as DIG peers
        const digPeers1 = node1.getDIGPeers()
        const digPeers2 = node2.getDIGPeers()
        
        console.log(`\n🔍 DIG Peer Discovery Results:`)
        console.log(`Node 1 found: ${digPeers1.length} DIG peers`)
        console.log(`Node 2 found: ${digPeers2.length} DIG peers`)
        
        if (digPeers1.length > 0 || digPeers2.length > 0) {
          console.log('🎉 SUCCESS: DIG peer discovery working!')
          
          // Test store sync
          console.log('\n🔄 Testing store synchronization...')
          await node1.syncNow()
          await node2.syncNow()
          
          await new Promise(resolve => setTimeout(resolve, 10000))
          
          const finalStatus1 = node1.getStatus()
          const finalStatus2 = node2.getStatus()
          
          console.log(`\n📊 Final Store Counts:`)
          console.log(`Node 1: ${finalStatus1.storeCount} stores`)
          console.log(`Node 2: ${finalStatus2.storeCount} stores`)
          
          if (finalStatus1.storeCount === finalStatus2.storeCount) {
            console.log('🎉 SUCCESS: Store synchronization working!')
            console.log('✅ DIG Network protocol is functional!')
          } else {
            console.log('⚠️ Store counts different - sync may need more time')
          }
          
        } else {
          console.log('❌ DIG peer discovery failed even with direct connection')
          console.log('🔍 Protocol issue detected')
        }
        
      } catch (dialError) {
        console.error('❌ Direct connection failed:', dialError)
      }
    } else {
      console.log('❌ Could not find local address for Node 2')
    }

  } catch (error) {
    console.error('❌ Direct connection test failed:', error)
  } finally {
    console.log('\n🛑 Stopping test nodes...')
    await node1.stop()
    await node2.stop()
    console.log('✅ Direct connection test completed')
  }
}

directConnectionTest().catch(console.error)
