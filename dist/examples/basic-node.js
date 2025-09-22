import { DIGNode } from '../src/node/DIGNode';
async function main() {
    const node = new DIGNode({
        port: 4002,
        digPath: process.env.DIG_PATH || undefined
    });
    try {
        console.log('Starting DIG Node...');
        await node.start();
        console.log('✅ DIG Node started successfully!');
        console.log('📁 Available stores:', node.getAvailableStores());
        console.log('🌐 Crypto IPv6:', node.getCryptoIPv6());
        console.log('🆔 Peer ID:', node.getNode().peerId.toString());
        // Display listening addresses
        const addresses = node.getNode().getMultiaddrs();
        console.log('🔗 Listening on:');
        addresses.forEach(addr => {
            console.log(`   ${addr.toString()}`);
        });
        // Keep running
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
        // Log periodic stats
        setInterval(() => {
            const peers = node.getNode().getPeers();
            console.log(`📊 Connected peers: ${peers.length}, Available stores: ${node.getAvailableStores().length}`);
        }, 30000); // Every 30 seconds
    }
    catch (error) {
        console.error('❌ Failed to start DIG node:', error);
        process.exit(1);
    }
}
main().catch(console.error);
//# sourceMappingURL=basic-node.js.map