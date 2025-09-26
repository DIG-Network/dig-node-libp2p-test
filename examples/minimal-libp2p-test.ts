/**
 * Minimal LibP2P Test
 * 
 * Absolute minimal test to get LibP2P working.
 * Focus ONLY on connecting to bootstrap server.
 */

import { createLibp2p } from 'libp2p'
import { tcp } from '@libp2p/tcp'
import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { bootstrap } from '@libp2p/bootstrap'
import { ping } from '@libp2p/ping'
import { identify } from '@libp2p/identify'

async function minimalLibP2PTest() {
  console.log('🔧 Minimal LibP2P Connection Test')
  console.log('=================================')
  console.log('')

  try {
    console.log('🚀 Creating minimal LibP2P node...')
    
    const node = await createLibp2p({
      addresses: {
        listen: ['/ip4/0.0.0.0/tcp/0'] // Auto-assign port
      },
      transports: [tcp()],
      connectionEncrypters: [noise()],
      streamMuxers: [yamux()],
      peerDiscovery: [
        bootstrap({
          list: [
            '/ip4/147.75.77.187/tcp/4001/p2p/QmQCU2EcMqAqQPR2i9bChDtGNJchTbq5TbXJJ16u19uLTa'
          ]
        })
      ],
      services: {
        ping: ping(),
        identify: identify()
      }
    })

    console.log(`✅ Node created: ${node.peerId.toString()}`)
    console.log(`📍 Listening: ${node.getMultiaddrs().map(addr => addr.toString()).join(', ')}`)

    // Monitor connections
    let connectionCount = 0
    node.addEventListener('peer:connect', (event) => {
      connectionCount++
      console.log(`🤝 Connected [${connectionCount}]: ${event.detail.toString().substring(0, 20)}...`)
    })

    node.addEventListener('peer:disconnect', (event) => {
      console.log(`👋 Disconnected: ${event.detail.toString().substring(0, 20)}...`)
    })

    // Wait and monitor
    console.log('\n⏱️ Monitoring for 60 seconds...')
    for (let i = 0; i < 12; i++) {
      await new Promise(resolve => setTimeout(resolve, 5000))
      const peers = node.getPeers()
      console.log(`[${(i + 1) * 5}s] Connected peers: ${peers.length}`)
      
      if (peers.length > 0) {
        console.log('🎉 LibP2P connection SUCCESS!')
        break
      }
    }

    const finalPeers = node.getPeers()
    console.log(`\n📊 Final result: ${finalPeers.length} peers connected`)
    
    if (finalPeers.length > 0) {
      console.log('✅ LibP2P networking is working!')
    } else {
      console.log('❌ LibP2P connection failed - network/firewall issue')
    }

    await node.stop()

  } catch (error) {
    console.error('❌ Minimal LibP2P test failed:', error)
  }
}

minimalLibP2PTest().catch(console.error)
