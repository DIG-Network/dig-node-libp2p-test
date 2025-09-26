/**
 * Remote Simple DIG Node
 * 
 * Single node test for remote server to connect to the P2P network
 * and sync .dig files from other nodes.
 */

import { SimpleDIGNode } from '../src/node2/SimpleDIGNode.js'

async function remoteSimpleDIG() {
  console.log('🌐 Remote Simple DIG Node')
  console.log('=========================')
  console.log('')

  const node = new SimpleDIGNode(4001) // Use port 4001 on remote

  try {
    console.log('🚀 Starting remote DIG node...')
    await node.start()

    console.log('\n📊 Initial Status:')
    const initialStatus = node.getStatus()
    console.log(`  Peer ID: ${initialStatus.peerId?.substring(0, 20)}...`)
    console.log(`  Local Stores: ${initialStatus.storeCount}`)
    console.log(`  Connected Peers: ${initialStatus.connectedPeers}`)

    // Monitor and sync periodically
    console.log('\n⏱️ Monitoring for DIG peers and syncing stores...')
    
    setInterval(async () => {
      const status = node.getStatus()
      const digPeers = node.getDIGPeers()
      
      console.log(`📊 Status: ${status.connectedPeers} peers, ${status.digPeers} DIG peers, ${status.storeCount} stores`)
      
      if (digPeers.length > 0) {
        console.log(`🎯 Found ${digPeers.length} DIG peers:`)
        for (const peer of digPeers) {
          console.log(`  🔗 ${peer.peerId.substring(0, 20)}... (${peer.stores.length} stores)`)
        }
        
        // Trigger sync
        console.log('🔄 Triggering store sync...')
        await node.syncNow()
        
        const afterSync = node.getStatus()
        console.log(`📁 After sync: ${afterSync.storeCount} stores`)
      }
    }, 30000) // Every 30 seconds

    // Keep running
    console.log('🔄 Node running - will sync automatically when DIG peers are found...')
    
    // Run indefinitely
    await new Promise(() => {}) // Keep running

  } catch (error) {
    console.error('❌ Remote DIG node failed:', error)
  }
}

remoteSimpleDIG().catch(console.error)
