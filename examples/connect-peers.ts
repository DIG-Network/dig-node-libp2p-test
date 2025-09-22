import { DIGNode } from '../src/node/DIGNode';

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 1) {
    console.log('Usage: npm run connect-peers <peer-address>');
    console.log('');
    console.log('Examples:');
    console.log('  npm run connect-peers /ip4/192.168.1.100/tcp/4001/p2p/12D3KooW...');
    console.log('  npm run connect-peers /ip4/10.0.0.5/tcp/4002/p2p/12D3KooW...');
    console.log('');
    console.log('To get your node\'s address, run the node and check the "Listening on:" output');
    process.exit(1);
  }

  const peerAddress = args[0];
  console.log(`🔗 Connecting to peer: ${peerAddress}`);

  // Start a temporary node for connection testing
  const node = new DIGNode({ port: 4004 });
  
  try {
    await node.start();
    
    console.log('📊 Local node info:');
    const connectionInfo = node.getConnectionInfo();
    console.log('🔗 Your node addresses:');
    connectionInfo.listeningAddresses.forEach((addr: string) => {
      console.log(`   ${addr}`);
    });
    
    console.log(`\n🔗 Attempting to connect to: ${peerAddress}`);
    await node.connectToPeer(peerAddress);
    
    // Wait a moment for connection to establish
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Check connection status
    const updatedInfo = node.getConnectionInfo();
    console.log(`\n✅ Connection successful!`);
    console.log(`👥 Connected peers: ${updatedInfo.connectedPeers.length}`);
    updatedInfo.connectedPeers.forEach((peer: string) => {
      console.log(`   ${peer}`);
    });
    
    // Test store discovery
    console.log('\n🔍 Discovering stores from connected peers...');
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    const finalInfo = node.getConnectionInfo();
    console.log('📋 Peer stores discovered:');
    for (const [peerId, stores] of Object.entries(finalInfo.peerStores)) {
      console.log(`   ${peerId}: ${(stores as string[]).length} stores`);
    }
    
    console.log('\n✅ Peer connection test completed successfully!');
    
  } catch (error) {
    console.error('❌ Connection failed:', error);
  } finally {
    await node.stop();
  }
}

main().catch(console.error);
