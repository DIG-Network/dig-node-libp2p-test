/**
 * Local-Remote Connection Test
 * 
 * Tests connection between local node and remote node
 * using manual addressing now that DIG protocol works.
 */

import { SimpleDIGNode } from '../src/node2/SimpleDIGNode.js'

async function localRemoteConnection() {
  console.log('🌍 Local-Remote DIG Connection Test')
  console.log('==================================')
  console.log('')

  const localNode = new SimpleDIGNode(9001)

  try {
    console.log('🚀 Starting local DIG node...')
    await localNode.start()

    const status = localNode.getStatus()
    console.log(`📍 Local node addresses:`)
    status.listeningAddresses.forEach(addr => console.log(`  🔗 ${addr}`))

    console.log(`\n📊 Local node has ${status.storeCount} .dig files`)

    // Wait for stabilization
    console.log('\n⏱️ Waiting for node to stabilize...')
    await new Promise(resolve => setTimeout(resolve, 10000))

    console.log('\n🌐 To connect from remote node, run:')
    console.log('```bash')
    console.log('ssh knowmadic "cd ~/app/dig-node-libp2p-test && node -e \\"')
    console.log('const { SimpleDIGNode } = require(\\'./dist/src/node2/SimpleDIGNode.js\\');')
    console.log('const node = new SimpleDIGNode(9002);')
    console.log('node.start().then(async () => {')
    console.log('  console.log(\\'🚀 REMOTE: Started\\');')
    
    // Get the external IP address (192.168.x.x)
    const externalAddr = status.listeningAddresses.find(addr => addr.includes('192.168.'))
    if (externalAddr) {
      console.log(`  await node.connectToRemote(\\'${externalAddr}\\');`)
    }
    
    console.log('  setInterval(() => {')
    console.log('    const status = node.getStatus();')
    console.log('    console.log(\\'📊 REMOTE: \\' + status.connectedPeers + \\' peers, \\' + status.digPeers + \\' DIG peers, \\' + status.storeCount + \\' stores\\');')
    console.log('  }, 10000);')
    console.log('}).catch(console.error);')
    console.log('\\"'')
    console.log('```')

    // Monitor for connections
    console.log('\n📡 Monitoring for remote connections...')
    
    let checkCount = 0
    const monitorInterval = setInterval(async () => {
      checkCount++
      const currentStatus = localNode.getStatus()
      const digPeers = localNode.getDIGPeers()
      
      console.log(`[${checkCount * 15}s] Local: ${currentStatus.connectedPeers} peers, ${currentStatus.digPeers} DIG peers, ${currentStatus.storeCount} stores`)
      
      if (digPeers.length > 0) {
        console.log('🎉 REMOTE CONNECTION DETECTED!')
        for (const peer of digPeers) {
          console.log(`  🔗 ${peer.peerId.substring(0, 20)}... (${peer.stores.length} stores)`)
        }
        
        console.log('🔄 Testing sync with remote...')
        await localNode.syncNow()
        
        const afterSync = localNode.getStatus()
        console.log(`📁 After sync: ${afterSync.storeCount} stores`)
        
        console.log('✅ LOCAL-REMOTE CONNECTION SUCCESS!')
      }
      
      if (checkCount >= 20) { // 5 minutes
        clearInterval(monitorInterval)
        console.log('⏰ Monitoring completed')
      }
      
    }, 15000)

  } catch (error) {
    console.error('❌ Local-remote connection test failed:', error)
  }
}

localRemoteConnection().catch(console.error)
