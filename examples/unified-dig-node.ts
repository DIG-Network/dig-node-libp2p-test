import { DIGNode } from '../src/node/DIGNode.js';

async function main() {
  console.log('🌍 Starting Unified DIG Node');
  console.log('============================');
  console.log('🔗 LibP2P P2P Network');
  console.log('🌐 Bootstrap Server'); 
  console.log('📡 TURN Server');
  console.log('🔐 Mandatory Noise Encryption');
  console.log('📁 File Sharing & Sync');
  console.log('🛡️ Mandatory Crypto-IPv6 Privacy');
  console.log('🕵️ Zero-Knowledge Features');
  console.log('⚠️ ALL PRIVACY FEATURES MANDATORY');
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
    
    // 🔐 ALL PRIVACY FEATURES MANDATORY: Crypto-IPv6, Zero-Knowledge, Noise Encryption
    // No configuration options - privacy cannot be disabled
    
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
    console.log(`   📡 TURN Coordination: ${node.getCapabilities().turnServer ? 'enabled' : 'disabled'}`);
    console.log(`   🔐 E2E Encryption: enabled`);
    console.log(`   🌐 Uses dedicated bootstrap server (not built-in)`);
    console.log('');
    console.log('🌍 Network Features:');
    console.log('   ✅ Unified peer discovery (public LibP2P + DIG filtering)');
    console.log('   ✅ Unified TURN coordination (decentralized)');
    console.log('   ✅ End-to-end encrypted transfers');
    console.log('   ✅ Resumable parallel downloads');
    console.log('   ✅ Zero-knowledge privacy features');
    console.log('   ✅ Automatic store synchronization');
    console.log('');
    console.log('🔗 Connection methods:');
    console.log(`   P2P: /ip4/[YOUR_IP]/tcp/${config.port}/p2p/[PEER_ID]`);
    console.log(`   Crypto-IPv6: /ip6/${node.getCryptoIPv6()}/tcp/${config.port}`);
    console.log('   Bootstrap: Uses dedicated AWS server');
    
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
