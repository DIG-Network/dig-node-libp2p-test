/**
 * Remote DIG Node Starter
 */

import { SimpleDIGNode } from '../dist/src/node2/SimpleDIGNode.js';

const node = new SimpleDIGNode(16001);

console.log('🚀 REMOTE: Starting DIG node...');
node.start().then(() => {
  console.log('🚀 REMOTE: DIG node started on port 16001');
  
  const status = node.getStatus();
  console.log('📍 REMOTE addresses:');
  status.listeningAddresses.forEach(addr => console.log(`  🔗 ${addr}`));
  console.log(`📊 REMOTE: ${status.storeCount} .dig files loaded`);
  
  // Monitor for connections
  setInterval(() => {
    const s = node.getStatus();
    const digPeers = node.getDIGPeers();
    
    console.log(`📊 REMOTE: ${s.connectedPeers} peers, ${s.digPeers} DIG peers, ${s.storeCount} stores`);
    
    if (digPeers.length > 0) {
      console.log('🎉 REMOTE: Found DIG peers!');
      digPeers.forEach(peer => 
        console.log(`  🔗 ${peer.peerId.substring(0, 20)}... (${peer.stores.length} stores)`)
      );
    }
  }, 20000);
  
}).catch(console.error);
