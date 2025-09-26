/**
 * Simple LibP2P Connection Test
 * 
 * Isolates and tests basic LibP2P connectivity without DIG Network complexity.
 * Helps diagnose why LibP2P connections are unstable.
 */

import { createLibp2p } from 'libp2p'
import { tcp } from '@libp2p/tcp'
import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { bootstrap } from '@libp2p/bootstrap'
import { ping } from '@libp2p/ping'
import { identify } from '@libp2p/identify'

async function simpleLibP2PTest() {
  console.log('🔍 Simple LibP2P Connection Test')
  console.log('================================')
  console.log('')

  try {
    console.log('🚀 Creating minimal LibP2P node...')
    
    const node = await createLibp2p({
      addresses: {
        listen: [
          '/ip4/0.0.0.0/tcp/0' // Let LibP2P choose available port
        ]
      },
      transports: [tcp()], // Only TCP transport
      connectionEncrypters: [noise()],
      streamMuxers: [yamux()],
      peerDiscovery: [
        bootstrap({
          list: [
            // Single stable bootstrap server
            '/dnsaddr/bootstrap.libp2p.io/p2p/QmNnooDu7bfjPFoTZYxMNLWUQJyrVwtbZg5gBMjTezGAJN'
          ]
        })
      ],
      services: {
        ping: ping(),
        identify: identify()
      },
      connectionManager: {
        maxConnections: 5,      // Very conservative
        dialTimeout: 15000,     // 15 second timeout
        maxParallelDials: 1     // One at a time
      }
    })

    console.log(`✅ LibP2P node created: ${node.peerId.toString()}`)
    console.log(`📍 Listening on: ${node.getMultiaddrs().map(addr => addr.toString()).join(', ')}`)

    // Monitor connections
    let connectionCount = 0
    let disconnectionCount = 0
    let stableConnections = new Set()

    node.addEventListener('peer:connect', (event) => {
      connectionCount++
      const peerId = event.detail.toString()
      stableConnections.add(peerId)
      console.log(`🤝 Connected (#${connectionCount}): ${peerId.substring(0, 20)}...`)
    })

    node.addEventListener('peer:disconnect', (event) => {
      disconnectionCount++
      const peerId = event.detail.toString()
      stableConnections.delete(peerId)
      console.log(`👋 Disconnected (#${disconnectionCount}): ${peerId.substring(0, 20)}...`)
    })

    // Start the node
    await node.start()
    console.log('✅ LibP2P node started')

    // Monitor for 2 minutes
    console.log('\n⏱️ Monitoring LibP2P connections for 2 minutes...')
    
    for (let i = 0; i < 12; i++) { // 12 * 10 seconds = 2 minutes
      await new Promise(resolve => setTimeout(resolve, 10000))
      
      const currentPeers = node.getPeers().length
      const elapsed = (i + 1) * 10
      
      console.log(`[${elapsed}s] 📊 Peers: ${currentPeers} connected, ${stableConnections.size} stable, ${connectionCount} total connects, ${disconnectionCount} disconnects`)
      
      // Test ping to connected peers
      if (currentPeers > 0) {
        try {
          const peer = node.getPeers()[0]
          await node.services.ping.ping(peer)
          console.log(`[${elapsed}s] 🏓 Ping successful to ${peer.toString().substring(0, 20)}...`)
        } catch (pingError) {
          console.log(`[${elapsed}s] ❌ Ping failed: ${pingError}`)
        }
      }
    }

    console.log('\n📊 LibP2P Test Results:')
    console.log('=======================')
    console.log(`Total Connections: ${connectionCount}`)
    console.log(`Total Disconnections: ${disconnectionCount}`)
    console.log(`Stable Connections: ${stableConnections.size}`)
    console.log(`Final Peer Count: ${node.getPeers().length}`)
    console.log(`Connection Stability: ${disconnectionCount === 0 ? 'Perfect' : connectionCount > disconnectionCount ? 'Good' : 'Poor'}`)

    await node.stop()
    console.log('✅ LibP2P test completed')

  } catch (error) {
    console.error('❌ LibP2P test failed:', error)
  }
}

simpleLibP2PTest().catch(console.error)
