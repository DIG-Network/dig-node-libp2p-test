import { DIGNode } from '../src/node/DIGNode';

async function main() {
  console.log('🏨 DIG Network - Hotel/Local Network Test');
  console.log('==========================================');
  
  // Configuration optimized for same network testing
  const config = {
    port: parseInt(process.env.DIG_PORT || '4001'),
    
    // Disable global discovery for local testing
    enableGlobalDiscovery: false,
    
    // Enable local network discovery
    enableMdns: true,
    enableDht: true,
    
    // Add LibP2P bootstrap for relay connections
    bootstrapPeers: [
      '/dnsaddr/bootstrap.libp2p.io/p2p/QmNnooDu7bfjPFoTZYxMNLWUQJyrVwtbZg5gBMjTezGAJN',
      '/dnsaddr/bootstrap.libp2p.io/p2p/QmQCU2EcMqAqQPR2i9bChDtGNJchTbq5TbXJJ16u19uLTa'
    ]
  };

  console.log('🔧 Configuration for hotel/restricted networks:');
  console.log('   - Local mDNS discovery: ENABLED');
  console.log('   - DHT discovery: ENABLED');
  console.log('   - LibP2P relay servers: ENABLED');
  console.log('   - Global discovery: DISABLED (for local testing)');
  console.log('   - NAT traversal: UPnP, AutoNAT, WebRTC, Circuit Relay');
  
  const node = new DIGNode(config);

  try {
    await node.start();
    
    const status = node.getStatus();
    const connectionInfo = node.getConnectionInfo();
    
    console.log('\n✅ DIG Node started for local network testing!');
    console.log('\n📊 Node Information:');
    console.log(`   - Peer ID: ${status.peerId}`);
    console.log(`   - Crypto IPv6: ${status.cryptoIPv6}`);
    console.log(`   - Local stores: ${status.stores.length}`);
    
    console.log('\n🔗 Your node addresses (for manual connection):');
    connectionInfo.listeningAddresses.forEach((addr: string) => {
      console.log(`   ${addr}`);
    });
    
    console.log('\n🏨 Hotel Network Troubleshooting:');
    console.log('   - Hotel networks often block peer-to-peer connections');
    console.log('   - Try connecting to hotel WiFi guest network if available');
    console.log('   - Consider using mobile hotspot for testing');
    console.log('   - LibP2P relay servers will help if direct connection fails');
    
    console.log('\n📋 To connect from second machine:');
    console.log('   1. Start this same command on second machine');
    console.log('   2. Wait for mDNS discovery (same network)');
    console.log('   3. Or manually connect using one of the addresses above');
    console.log(`   4. Example: npm run connect-peers "${connectionInfo.listeningAddresses[0]}"`);
    
    // Enhanced status logging for hotel networks
    setInterval(() => {
      const health = node.getNetworkHealth();
      const metrics = node.getMetrics();
      const currentInfo = node.getConnectionInfo();
      
      console.log(`\n📊 Network Status (Hotel Network):`);
      console.log(`   - Connected peers: ${health.connectedPeers}`);
      console.log(`   - Stores shared: ${health.storesShared}`);
      console.log(`   - mDNS discovery active: ${config.enableMdns}`);
      console.log(`   - LibP2P bootstrap connections: ${currentInfo.connectedPeers.length > 0 ? 'YES' : 'NO'}`);
      console.log(`   - Uptime: ${Math.round(metrics.uptime / 1000)}s`);
      
      if (health.connectedPeers === 0) {
        console.log('⚠️  Hotel network may be blocking P2P connections');
        console.log('   Try: Mobile hotspot, guest network, or manual connection');
      }
      
      if (currentInfo.connectedPeers.length > 0) {
        console.log('🎉 Connected peers:');
        currentInfo.connectedPeers.forEach((peer: string) => {
          console.log(`   - ${peer}`);
        });
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
