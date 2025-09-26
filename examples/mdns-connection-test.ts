/**
 * mDNS Connection Test
 * 
 * Use mDNS (local network discovery) to connect nodes
 * without relying on external bootstrap servers.
 * This should work on local network regardless of internet connectivity.
 */

import { createLibp2p } from 'libp2p'
import { tcp } from '@libp2p/tcp'
import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { mdns } from '@libp2p/mdns'
import { ping } from '@libp2p/ping'
import { identify } from '@libp2p/identify'

async function mdnsConnectionTest() {
  console.log('🏠 mDNS Local Network Connection Test')
  console.log('====================================')
  console.log('')

  const node1 = await createLibp2p({
    addresses: {
      listen: ['/ip4/0.0.0.0/tcp/7001']
    },
    transports: [tcp()],
    connectionEncrypters: [noise()],
    streamMuxers: [yamux()],
    peerDiscovery: [
      mdns() // Only local network discovery
    ],
    services: {
      ping: ping(),
      identify: identify()
    }
  })

  const node2 = await createLibp2p({
    addresses: {
      listen: ['/ip4/0.0.0.0/tcp/7002']
    },
    transports: [tcp()],
    connectionEncrypters: [noise()],
    streamMuxers: [yamux()],
    peerDiscovery: [
      mdns() // Only local network discovery
    ],
    services: {
      ping: ping(),
      identify: identify()
    }
  })

  try {
    console.log(`✅ Node 1: ${node1.peerId.toString()}`)
    console.log(`✅ Node 2: ${node2.peerId.toString()}`)

    // Monitor connections
    let node1Connections = 0
    let node2Connections = 0

    node1.addEventListener('peer:connect', (event) => {
      node1Connections++
      console.log(`🤝 Node1 connected [${node1Connections}]: ${event.detail.toString().substring(0, 20)}...`)
    })

    node2.addEventListener('peer:connect', (event) => {
      node2Connections++
      console.log(`🤝 Node2 connected [${node2Connections}]: ${event.detail.toString().substring(0, 20)}...`)
    })

    // Wait for mDNS discovery
    console.log('\n⏱️ Waiting for mDNS discovery (45 seconds)...')
    for (let i = 0; i < 9; i++) {
      await new Promise(resolve => setTimeout(resolve, 5000))
      const peers1 = node1.getPeers().length
      const peers2 = node2.getPeers().length
      console.log(`[${(i + 1) * 5}s] Node1: ${peers1} peers | Node2: ${peers2} peers`)
      
      if (peers1 > 0 || peers2 > 0) {
        console.log('🎉 mDNS connection SUCCESS!')
        break
      }
    }

    const finalPeers1 = node1.getPeers().length
    const finalPeers2 = node2.getPeers().length

    console.log(`\n📊 Final Results:`)
    console.log(`Node 1: ${finalPeers1} peers`)
    console.log(`Node 2: ${finalPeers2} peers`)

    if (finalPeers1 > 0 || finalPeers2 > 0) {
      console.log('✅ Local network connectivity WORKING!')
      console.log('💡 Can use mDNS for local connections')
    } else {
      console.log('❌ Even mDNS failed - deeper network issue')
    }

  } catch (error) {
    console.error('❌ mDNS test failed:', error)
  } finally {
    await node1.stop()
    await node2.stop()
    console.log('✅ mDNS test completed')
  }
}

mdnsConnectionTest().catch(console.error)
