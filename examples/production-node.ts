import { DIGNode } from '../src/node/DIGNode';
import { DIGGateway } from '../src/gateway/http-gateway';

async function main() {
  // Production configuration
  const config = {
    port: parseInt(process.env.DIG_PORT || '4001'),
    digPath: process.env.DIG_PATH || undefined,
    publicKey: process.env.DIG_PUBLIC_KEY || undefined,
    privateKey: process.env.DIG_PRIVATE_KEY || undefined,
    bootstrapPeers: process.env.DIG_BOOTSTRAP_PEERS ? 
      process.env.DIG_BOOTSTRAP_PEERS.split(',') : undefined
  };

  const gatewayPort = parseInt(process.env.GATEWAY_PORT || '8080');
  
  console.log('🚀 Starting DIG Network Node in production mode...');
  console.log('📊 Configuration:');
  console.log(`   - P2P Port: ${config.port}`);
  console.log(`   - Gateway Port: ${gatewayPort}`);
  console.log(`   - DIG Path: ${config.digPath || '~/.dig'}`);
  console.log(`   - Log Level: ${process.env.DIG_LOG_LEVEL || 'INFO'}`);

  try {
    // Start DIG node
    const node = new DIGNode(config);
    await node.start();
    
    // Start HTTP gateway
    const gateway = new DIGGateway(gatewayPort);
    await gateway.start();
    
    // Display startup information
    const status = node.getStatus();
    const health = node.getNetworkHealth();
    
    console.log('\n🎉 DIG Network Node started successfully!');
    console.log('📊 Node Status:');
    console.log(`   - Peer ID: ${status.peerId}`);
    console.log(`   - Crypto IPv6: ${status.cryptoIPv6}`);
    console.log(`   - Stores: ${status.stores.length}`);
    console.log(`   - Connected Peers: ${health.connectedPeers}`);
    console.log('\n🌐 Endpoints:');
    console.log(`   - Health: http://localhost:${gatewayPort}/health`);
    console.log(`   - Metrics: http://localhost:${gatewayPort}/metrics`);
    console.log(`   - Stores: http://localhost:${gatewayPort}/stores`);
    console.log('\n🔗 P2P Addresses:');
    status.addresses.forEach((addr: string) => {
      console.log(`   - ${addr}`);
    });

    // Graceful shutdown handlers
    const shutdown = async (signal: string) => {
      console.log(`\n🛑 Received ${signal}, shutting down gracefully...`);
      
      try {
        await gateway.stop();
        console.log('✅ Gateway stopped');
        
        await node.stop();
        console.log('✅ Node stopped');
        
        console.log('✅ Shutdown complete');
        process.exit(0);
      } catch (error) {
        console.error('❌ Error during shutdown:', error);
        process.exit(1);
      }
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

    // Periodic status logging
    setInterval(() => {
      const currentHealth = node.getNetworkHealth();
      const currentMetrics = node.getMetrics();
      
      console.log(`📊 Status - Peers: ${currentHealth.connectedPeers}, Stores: ${currentHealth.storesShared}, Uptime: ${Math.round(currentMetrics.uptime / 1000)}s`);
      
      if (currentMetrics.errors > 0) {
        console.log(`⚠️  Errors: ${currentMetrics.errors}, Success Rate: ${currentMetrics.successRate.toFixed(1)}%`);
      }
    }, 60000); // Every minute

    // Keep process alive
    console.log('\n🔄 Node running... Press Ctrl+C to stop');
    
  } catch (error) {
    console.error('❌ Failed to start DIG Network Node:', error);
    process.exit(1);
  }
}

main().catch(console.error);
