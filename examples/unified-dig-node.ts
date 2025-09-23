import { DIGNode } from '../src/node/DIGNode.js';

async function main() {
  console.log('🌍 Starting Unified DIG Node');
  console.log('============================');
  console.log('🔗 LibP2P P2P Network');
  console.log('🌐 Bootstrap Server'); 
  console.log('📡 TURN Server');
  console.log('🔐 End-to-End Encryption');
  console.log('📁 File Sharing & Sync');
  console.log('🛡️ Crypto-IPv6 Privacy Network');
  console.log('');

  // Configuration for unified node
  const config = {
    port: parseInt(process.env.DIG_PORT || '4001'),
    digPath: process.env.DIG_PATH || (process.env.NODE_ENV === 'production' ? '/app/dig' : undefined),
    
    // Bootstrap from DIG network (AWS EBS instance + other DIG nodes)
    discoveryServers: process.env.DIG_BOOTSTRAP_NODES ? 
      process.env.DIG_BOOTSTRAP_NODES.split(',') : [
        'http://dig-bootstrap-v2-prod.eba-vfishzna.us-east-1.elasticbeanstalk.com'
      ],
    
    // Enable all capabilities
    enableMdns: true,
    enableDht: true,
    enableGlobalDiscovery: true,
    enableTurnServer: true,
    turnPort: parseInt(process.env.TURN_PORT || '3478'),
    
    // 🔐 PRIVACY MODE: Only expose crypto-IPv6 addresses, hide real IPs
    privacyMode: process.env.DIG_PRIVACY_MODE === 'true',
    enableCryptoIPv6Overlay: process.env.DIG_CRYPTO_IPV6_OVERLAY === 'true',
    
    // Optional manual connections
    connectToPeers: process.env.DIG_CONNECT_PEERS ? 
      process.env.DIG_CONNECT_PEERS.split(',') : []
  };

  const node = new DIGNode(config);

  try {
    await node.start();
    
    console.log('🎉 Unified DIG Node started successfully!');
    console.log('');
    console.log('📊 Services Running:');
    console.log(`   🔗 P2P Network: port ${config.port}`);
    console.log(`   🌐 Bootstrap Server: port ${config.port + 1000}`);
    console.log(`   📡 TURN Server: port ${config.turnPort}`);
    console.log(`   🔐 E2E Encryption: enabled`);
    console.log('');
    console.log('🌍 Network Features:');
    console.log('   ✅ Peer-to-peer file sharing');
    console.log('   ✅ Bootstrap server for other nodes');
    console.log('   ✅ TURN server for NAT traversal');
    console.log('   ✅ End-to-end encrypted transfers');
    console.log('   ✅ Protocol version negotiation');
    console.log('   ✅ Automatic store synchronization');
    console.log('   ✅ Real-time file watching');
    console.log('');
    console.log('🔗 Other nodes can connect to this node at:');
    console.log(`   Bootstrap: http://[YOUR_IP]:${config.port + 1000}`);
    console.log(`   P2P: /ip4/[YOUR_IP]/tcp/${config.port}/p2p/[PEER_ID]`);
    console.log('');
    console.log('💡 To connect from another machine:');
    console.log(`   DIG_BOOTSTRAP_NODES="http://[THIS_IP]:${config.port + 1000}" npm run unified`);
    
    // Enhanced status logging
    setInterval(() => {
      const status = node.getStatus();
      const health = node.getNetworkHealth();
      
      console.log(`\n📊 Unified DIG Node Status:`);
      console.log(`   🔗 P2P Peers: ${health.connectedPeers}`);
      console.log(`   📁 Stores: ${health.storesShared}`);
      console.log(`   ⏱️ Uptime: ${Math.round((Date.now() - status.startTime || Date.now()) / 1000)}s`);
      
      if (health.connectedPeers === 0) {
        console.log('   ⚠️ No peers connected - network is isolated');
        console.log('   💡 Share your bootstrap URL with other nodes');
      }
    }, 60000); // Every minute

    // Graceful shutdown
    process.on('SIGINT', async () => {
      console.log('\n🛑 Shutting down Unified DIG Node...');
      await node.stop();
      console.log('✅ Shutdown complete');
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      console.log('\n🛑 Received SIGTERM, shutting down...');
      await node.stop();
      console.log('✅ Shutdown complete');
      process.exit(0);
    });
    
  } catch (error) {
    console.error('❌ Failed to start Unified DIG Node:', error);
    process.exit(1);
  }
}

main().catch(console.error);
