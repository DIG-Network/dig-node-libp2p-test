/**
 * Hotel Network Connection Test
 * 
 * Simple test to help two DIG nodes find each other in hotel networks
 */

import { DIGNode } from '../src/node/DIGNode.js'

async function hotelNetworkTest() {
  console.log('🏨 Hotel Network DIG Peer Connection Test')
  console.log('=========================================')
  console.log('')

  // Get network information
  const { networkInterfaces } = await import('os')
  const interfaces = networkInterfaces()
  
  console.log('🔍 Your network information:')
  for (const [name, addresses] of Object.entries(interfaces)) {
    if (!addresses) continue
    
    for (const addr of addresses) {
      if (addr.family === 'IPv4' && !addr.internal) {
        console.log(`   Interface: ${name}`)
        console.log(`   IP Address: ${addr.address}`)
        console.log(`   Network: ${addr.address.split('.').slice(0, 3).join('.')}.0/24`)
        console.log('')
      }
    }
  }

  // Start DIG node with enhanced discovery
  const port = parseInt(process.env.DIG_PORT || '4001')
  console.log(`🚀 Starting DIG node on port ${port}...`)
  
  const node = new DIGNode({
    port,
    enableMdns: true,
    enableDht: true,
    discoveryServers: [] // Use public bootstrap only
  })

  try {
    await node.start()
    
    const status = node.getStatus()
    console.log('✅ DIG Node started!')
    console.log(`   🆔 Peer ID: ${status.peerId}`)
    console.log(`   🔐 Crypto-IPv6: ${status.cryptoIPv6}`)
    console.log(`   📁 Stores: ${status.stores.length}`)
    console.log('')

    console.log('🔍 Looking for other DIG nodes...')
    console.log('   Method 1: mDNS local discovery')
    console.log('   Method 2: Local network scanning')  
    console.log('   Method 3: DHT search via public bootstrap')
    console.log('   Method 4: GossipSub announcements')
    console.log('')

    // Monitor connections every 10 seconds
    let lastPeerCount = 0
    setInterval(async () => {
      const health = node.getNetworkHealth()
      const connectionInfo = node.getConnectionInfo()
      
      if (health.digPeers !== lastPeerCount) {
        lastPeerCount = health.digPeers
        
        if (health.digPeers > 0) {
          console.log(`🎉 SUCCESS: Found ${health.digPeers} DIG peer(s)!`)
          console.log(`📁 ${health.storesShared} stores available for sync`)
          
          // Show connected DIG peers
          const digPeers = connectionInfo.connectedPeers || []
          for (const peerId of digPeers.slice(0, 3)) {
            console.log(`   🤝 Connected DIG peer: ${peerId}`)
          }
          console.log('')
        } else {
          console.log(`🔍 Still searching... (${health.connectedPeers} total peers connected)`)
        }
      }
    }, 10000)

    console.log('💡 Manual connection help:')
    console.log('   If automatic discovery fails, get the other machine\'s IP and run:')
    console.log('   await node.connectToLocalPeer("OTHER_MACHINE_IP", 4001)')
    console.log('')
    console.log('🔄 Monitoring for connections...')

  } catch (error) {
    console.error('❌ Failed to start DIG node:', error)
    process.exit(1)
  }
}

hotelNetworkTest().catch(console.error)
