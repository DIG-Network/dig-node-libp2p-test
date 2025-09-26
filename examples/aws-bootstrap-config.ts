/**
 * AWS Bootstrap Server Configuration Example
 * 
 * Shows how to configure DIG nodes to use the cost-aware AWS bootstrap server
 * as a last resort fallback for both peer discovery and TURN relay.
 */

import { DIGNode } from '../src/node/DIGNode.js'

// Set environment variables for AWS bootstrap fallback
process.env.DIG_AWS_BOOTSTRAP_URL = 'http://awseb--AWSEB-qNbAdipmcXyx-770761774.us-east-1.elb.amazonaws.com'
process.env.DIG_AWS_BOOTSTRAP_ENABLED = 'true'
process.env.DIG_USER_TIER = 'standard' // free, basic, standard, premium
process.env.DIG_IS_PREMIUM = 'false'

async function startDIGNodeWithAWSFallback() {
  console.log('🚀 Starting DIG Node with AWS Bootstrap Fallback...')
  console.log('============================================')

  const node = new DIGNode({
    port: 4001,
    enableMdns: true,
    enableDht: true,
    enableTurnServer: true,
    // Custom bootstrap servers can be added here
    bootstrapPeers: [
      // Add any custom DIG bootstrap servers
    ]
  })

  try {
    await node.start()

    console.log('\n📊 DIG Node Status:')
    const connectionInfo = node.getConnectionInfo()
    console.log(`   Connected Peers: ${connectionInfo.peerCount}`)
    console.log(`   DIG Peers: ${connectionInfo.digPeers}`)
    console.log(`   TURN Servers: ${connectionInfo.turnServers}`)
    console.log(`   Connection Methods: ${connectionInfo.availableConnectionMethods.join(', ')}`)

    // Test AWS bootstrap fallback
    console.log('\n🌐 Testing AWS Bootstrap Fallback:')
    const awsRegistered = await node.useAWSBootstrapFallback()
    console.log(`   AWS Registration: ${awsRegistered ? '✅ Success' : '❌ Failed'}`)

    if (awsRegistered) {
      // Test TURN allocation
      const turnResult = await node.useAWSBootstrapTURNFallback('test-peer', 'test-store')
      console.log(`   TURN Allocation: ${turnResult ? '✅ Success' : '❌ Failed'}`)
      
      if (turnResult) {
        console.log(`   Session ID: ${turnResult.sessionId}`)
        console.log(`   Priority Level: ${turnResult.limits?.priorityLevel}`)
        console.log(`   Cost Info: ${(turnResult.costInfo?.currentCostRatio * 100).toFixed(1)}% budget used`)
      }
    }

    // Keep running to monitor AWS bootstrap integration
    console.log('\n⏱️  Monitoring AWS bootstrap integration...')
    
    // Monitor peer discovery and TURN usage
    setInterval(() => {
      const info = node.getConnectionInfo()
      console.log(`📊 Status: ${info.peerCount} peers, ${info.turnServers} TURN servers`)
    }, 30000)

    // Keep the process running
    await new Promise(() => {}) // Run indefinitely

  } catch (error) {
    console.error('❌ Failed to start DIG Node:', error)
    process.exit(1)
  }
}

// Configuration examples for different scenarios
export const configurations = {
  // Free tier user with AWS fallback
  freeTier: {
    DIG_AWS_BOOTSTRAP_ENABLED: 'true',
    DIG_USER_TIER: 'free',
    DIG_IS_PREMIUM: 'false'
  },

  // Premium user with priority access
  premiumUser: {
    DIG_AWS_BOOTSTRAP_ENABLED: 'true',
    DIG_USER_TIER: 'premium',
    DIG_IS_PREMIUM: 'true'
  },

  // Disable AWS fallback (P2P only)
  p2pOnly: {
    DIG_AWS_BOOTSTRAP_ENABLED: 'false'
  },

  // Custom AWS bootstrap server
  customBootstrap: {
    DIG_AWS_BOOTSTRAP_URL: 'https://your-custom-bootstrap.com',
    DIG_AWS_BOOTSTRAP_ENABLED: 'true',
    DIG_USER_TIER: 'standard'
  }
}

// Start the example
if (import.meta.url === `file://${process.argv[1]}`) {
  startDIGNodeWithAWSFallback().catch(console.error)
}

export { startDIGNodeWithAWSFallback }
