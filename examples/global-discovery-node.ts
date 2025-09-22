import { DIGNode } from '../src/node/DIGNode';

async function main() {
  // Set debug logging to see connection details
  process.env.DIG_LOG_LEVEL = 'DEBUG'
  
  // Configuration for global peer discovery
  const config = {
    port: parseInt(process.env.DIG_PORT || '4001'),
    digPath: process.env.DIG_PATH || undefined,
    
    // Global discovery configuration - using deployed bootstrap server
    discoveryServers: [
      'http://dig-bootstrap-prod.eba-rdpk2jmt.us-east-1.elasticbeanstalk.com'
    ],
    
    // Enable all discovery mechanisms
    enableMdns: true,        // Local network discovery
    enableDht: true,         // DHT-based discovery
    enableGlobalDiscovery: true,
    
    // Optional: Add known peers for immediate connection
    connectToPeers: process.env.DIG_CONNECT_PEERS ? 
      process.env.DIG_CONNECT_PEERS.split(',') : [],
    
    // Optional: Custom bootstrap peers (LibP2P bootstrap nodes)
    bootstrapPeers: process.env.DIG_BOOTSTRAP_PEERS ? 
      process.env.DIG_BOOTSTRAP_PEERS.split(',') : []
  };

  console.log('🚀 Starting DIG Node with global discovery...');
  console.log('🌍 Discovery servers:', config.discoveryServers);
  
  const node = new DIGNode(config);

  try {
    await node.start();
    
    // Display connection information
    const connectionInfo = node.getConnectionInfo();
    const status = node.getStatus();
    
    console.log('\n✅ DIG Node started with global discovery!');
    console.log('\n📊 Node Information:');
    console.log(`   - Peer ID: ${status.peerId}`);
    console.log(`   - Crypto IPv6: ${status.cryptoIPv6}`);
    console.log(`   - Local stores: ${status.stores.length}`);
    
    console.log('\n🔗 Your node addresses (share these with other nodes):');
    connectionInfo.listeningAddresses.forEach((addr: string) => {
      console.log(`   ${addr}`);
    });
    
    console.log('\n🌍 Global discovery features:');
    console.log('   ✅ Automatic registration with bootstrap servers');
    console.log('   ✅ Periodic peer discovery');
    console.log('   ✅ Store synchronization across the globe');
    console.log('   ✅ DHT-based peer announcements');
    
    // Enhanced status logging
    setInterval(() => {
      const health = node.getNetworkHealth();
      const metrics = node.getMetrics();
      
      console.log(`\n📊 Network Status:`);
      console.log(`   - Connected peers: ${health.connectedPeers}`);
      console.log(`   - Stores shared: ${health.storesShared}`);
      console.log(`   - Sync success rate: ${metrics.syncSuccessRate.toFixed(1)}%`);
      console.log(`   - Download success rate: ${metrics.successRate.toFixed(1)}%`);
      console.log(`   - Uptime: ${Math.round(metrics.uptime / 1000)}s`);
      
      if (health.connectedPeers === 0) {
        console.log('⚠️  No peers connected - check network connectivity and bootstrap servers');
      }
    }, 30000); // Every 30 seconds

    // Graceful shutdown
    process.on('SIGINT', async () => {
      console.log('\n🛑 Shutting down...');
      await node.stop();
      console.log('✅ Node stopped gracefully');
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      console.log('\n🛑 Received SIGTERM, shutting down...');
      await node.stop();
      console.log('✅ Node stopped gracefully');
      process.exit(0);
    });
    
  } catch (error) {
    console.error('❌ Failed to start DIG node:', error);
    process.exit(1);
  }
}

main().catch(console.error);
