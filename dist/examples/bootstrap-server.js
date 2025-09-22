import { BootstrapServer } from '../src/bootstrap/BootstrapServer.js';
async function main() {
    const port = parseInt(process.env.PORT || '3000');
    console.log('🌍 Starting DIG Network Bootstrap Server...');
    console.log(`📡 Port: ${port}`);
    console.log(`🔧 Environment: ${process.env.NODE_ENV || 'development'}`);
    const server = new BootstrapServer(port);
    try {
        await server.start();
        console.log('\n✅ Bootstrap Server started successfully!');
        console.log('\n📋 Available endpoints:');
        console.log(`   - Health: http://localhost:${port}/health`);
        console.log(`   - Stats: http://localhost:${port}/stats`);
        console.log(`   - Register: POST http://localhost:${port}/register`);
        console.log(`   - Discover: GET http://localhost:${port}/peers`);
        console.log(`   - Store peers: GET http://localhost:${port}/peers/store/{storeId}`);
        console.log(`   - Topology: GET http://localhost:${port}/topology`);
        console.log('\n🌐 For production deployment:');
        console.log('   1. Deploy this server to bootstrap1.dig.net');
        console.log('   2. Configure DIG nodes to use: bootstrap1.dig.net:3000');
        console.log('   3. Set up SSL/TLS for HTTPS');
        console.log('   4. Configure firewall to allow port 3000');
        console.log('\n📊 Server is running... Press Ctrl+C to stop');
        // Log periodic stats
        setInterval(() => {
            const stats = server.getStats();
            console.log(`📊 Stats - Active peers: ${stats.activePeers}/${stats.totalPeers}, Uptime: ${Math.round(stats.uptime)}s`);
        }, 60000); // Every minute
    }
    catch (error) {
        console.error('❌ Failed to start bootstrap server:', error);
        process.exit(1);
    }
}
main().catch(console.error);
//# sourceMappingURL=bootstrap-server.js.map