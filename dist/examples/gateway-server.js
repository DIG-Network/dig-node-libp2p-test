import { DIGGateway } from '../src/gateway/http-gateway';
async function main() {
    const port = parseInt(process.env.PORT || '8080');
    const gateway = new DIGGateway(port);
    try {
        console.log('Starting DIG Gateway...');
        await gateway.start();
        console.log('✅ DIG Gateway started successfully!');
        console.log(`🌐 HTTP Gateway: http://localhost:${port}`);
        console.log(`📊 Health check: http://localhost:${port}/health`);
        console.log(`📁 Available stores: http://localhost:${port}/stores`);
        const digNode = gateway.getDigNode();
        console.log('🆔 Peer ID:', digNode.getNode().peerId.toString());
        console.log('🌐 Crypto IPv6:', digNode.getCryptoIPv6());
        console.log('📁 Local stores:', digNode.getAvailableStores());
        // Keep running
        process.on('SIGINT', async () => {
            console.log('\n🛑 Shutting down gateway...');
            await gateway.stop();
            console.log('✅ Gateway stopped gracefully');
            process.exit(0);
        });
        process.on('SIGTERM', async () => {
            console.log('\n🛑 Received SIGTERM, shutting down gateway...');
            await gateway.stop();
            console.log('✅ Gateway stopped gracefully');
            process.exit(0);
        });
        // Log periodic stats
        setInterval(() => {
            const peers = digNode.getNode().getPeers();
            const stores = digNode.getAvailableStores();
            console.log(`📊 Stats - Connected peers: ${peers.length}, Local stores: ${stores.length}`);
        }, 60000); // Every minute
    }
    catch (error) {
        console.error('❌ Failed to start DIG gateway:', error);
        process.exit(1);
    }
}
main().catch(console.error);
//# sourceMappingURL=gateway-server.js.map