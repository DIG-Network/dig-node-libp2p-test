/**
 * Start Remote DIG Node
 */

const { SimpleDIGNode } = require('../dist/src/node2/SimpleDIGNode.js');

async function startRemote() {
  const node = new SimpleDIGNode(9002);
  
  console.log('🚀 REMOTE: Starting...');
  await node.start();
  
  const status = node.getStatus();
  console.log('📍 REMOTE addresses:');
  status.listeningAddresses.forEach(addr => console.log(`  🔗 ${addr}`));
  console.log(`📊 REMOTE: ${status.storeCount} .dig files`);
  
  console.log('⏱️ Ready for local connection...');
  
  // Monitor status
  setInterval(() => {
    const s = node.getStatus();
    console.log(`📊 REMOTE: ${s.connectedPeers} peers, ${s.digPeers} DIG peers, ${s.storeCount} stores`);
    
    if (s.digPeers > 0) {
      console.log('🎉 CONNECTED TO LOCAL NODE!');
    }
  }, 15000);
}

startRemote().catch(console.error);
