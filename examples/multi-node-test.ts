import { DIGNode } from '../src/node/DIGNode.js';

async function testMultipleNodesOnSameNetwork() {
  console.log('🧪 Testing Multiple DIG Nodes on Same Network');
  console.log('===============================================');
  console.log('🎯 Testing UPnP port conflict resolution');
  console.log('🏠 Testing local network discovery');
  console.log('🔗 Testing peer-to-peer connectivity');
  console.log('');

  const nodes: DIGNode[] = [];

  try {
    // Start 3 DIG nodes with the same preferred port to test conflict resolution
    console.log('🚀 Starting DIG nodes...');
    
    for (let i = 0; i < 3; i++) {
      const nodeConfig = {
        port: 4001, // All nodes prefer the same port - should resolve conflicts
        digPath: `./test-dig-${i}`,
        enableMdns: true,
        enableDht: true,
        enableGlobalDiscovery: true,
        enableTurnServer: false, // Disable TURN for this test
        publicKey: `test-key-${i}-${Date.now()}`
      };

      console.log(`   📡 Starting DIG Node ${i + 1}...`);
      const node = new DIGNode(nodeConfig);
      await node.start();
      
      nodes.push(node);
      
      const status = node.getStatus();
      console.log(`   ✅ Node ${i + 1} started on port ${status.actualPort || nodeConfig.port}`);
      console.log(`   🔐 Crypto-IPv6: ${node.getCryptoIPv6()}`);
      console.log('');

      // Wait a bit between node starts
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    console.log('🔍 Monitoring inter-node discovery...');
    console.log('');

    // Monitor for 60 seconds to see if nodes discover each other
    let discoveryCount = 0;
    const maxAttempts = 30; // 30 attempts over 60 seconds

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      console.log(`📊 Discovery Check ${attempt + 1}/${maxAttempts}:`);
      
      let totalPeers = 0;
      let totalDIGPeers = 0;
      
      for (let i = 0; i < nodes.length; i++) {
        const health = nodes[i].getNetworkHealth();
        const connectionInfo = nodes[i].getConnectionInfo();
        
        totalPeers += health.connectedPeers;
        totalDIGPeers += health.digPeers || 0;
        
        console.log(`   Node ${i + 1}: ${health.connectedPeers} peers, ${health.digPeers || 0} DIG peers`);
        
        // Show UPnP status
        const upnpStatus = nodes[i].getUPnPStatus();
        if (upnpStatus.available) {
          console.log(`     UPnP: ${upnpStatus.totalMappings} mappings active`);
        }
      }

      if (totalDIGPeers >= 2) { // Each node should find at least one other DIG node
        discoveryCount++;
        console.log(`   🎉 SUCCESS: DIG nodes are discovering each other! (${totalDIGPeers} total DIG connections)`);
        
        if (discoveryCount >= 3) {
          console.log('   ✅ Stable inter-node discovery achieved!');
          break;
        }
      } else {
        console.log(`   ⏳ Waiting for discovery... (${totalDIGPeers} DIG connections so far)`);
      }

      console.log('');
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    // Final results
    console.log('📈 Final Results:');
    console.log('================');
    
    let allPortsUnique = true;
    const usedPorts = new Set<number>();
    
    for (let i = 0; i < nodes.length; i++) {
      const status = nodes[i].getStatus();
      const health = nodes[i].getNetworkHealth();
      const connectionInfo = nodes[i].getConnectionInfo();
      const upnpStatus = nodes[i].getUPnPStatus();
      
      const actualPort = status.actualPort || 4001;
      
      if (usedPorts.has(actualPort)) {
        allPortsUnique = false;
      }
      usedPorts.add(actualPort);
      
      console.log(`Node ${i + 1}:`);
      console.log(`   Port: ${actualPort} ${actualPort !== 4001 ? '(conflict resolved)' : '(preferred)'}`);
      console.log(`   Peers: ${health.connectedPeers} total, ${health.digPeers || 0} DIG nodes`);
      console.log(`   UPnP: ${upnpStatus.available ? `${upnpStatus.totalMappings} mappings` : 'unavailable'}`);
      console.log(`   Crypto-IPv6: ${nodes[i].getCryptoIPv6()}`);
      console.log('');
    }

    // Test results
    console.log('🧪 Test Results:');
    console.log(`   ✅ Port Conflict Resolution: ${allPortsUnique ? 'PASSED' : 'FAILED'}`);
    console.log(`   ✅ Local Discovery: ${discoveryCount >= 3 ? 'PASSED' : 'PARTIAL'}`);
    console.log(`   ✅ Multi-Node Stability: ${nodes.every(n => n.getStatus().isRunning) ? 'PASSED' : 'FAILED'}`);
    
    if (allPortsUnique && discoveryCount >= 3) {
      console.log('');
      console.log('🎉 ALL TESTS PASSED! Multiple DIG nodes can run on same network!');
    } else {
      console.log('');
      console.log('⚠️ Some tests failed - see results above for details');
    }

  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    // Cleanup
    console.log('');
    console.log('🧹 Cleaning up test nodes...');
    
    for (let i = 0; i < nodes.length; i++) {
      try {
        await nodes[i].stop();
        console.log(`   ✅ Node ${i + 1} stopped`);
      } catch (error) {
        console.log(`   ⚠️ Error stopping Node ${i + 1}:`, error);
      }
    }
    
    console.log('✅ Test cleanup complete');
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Test interrupted by user');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Test terminated');
  process.exit(0);
});

testMultipleNodesOnSameNetwork().catch(console.error); 