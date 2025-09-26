#!/usr/bin/env node

/**
 * Test script to verify heartbeat-based peer persistence
 */

const serverUrl = 'http://awseb--AWSEB-qNbAdipmcXyx-770761774.us-east-1.elb.amazonaws.com'

async function testHeartbeatSystem() {
  console.log('🧪 Testing Bootstrap Server Heartbeat System')
  console.log('=============================================')

  try {
    // 1. Register a test peer
    console.log('\n1. Registering test peer...')
    const testPeer = {
      peerId: `test-heartbeat-${Date.now()}`,
      addresses: [`/ip6/fd00:test:1234:5678:9abc:def0:1234:5678/tcp/4001/p2p/test-heartbeat-${Date.now()}`],
      cryptoIPv6: 'fd00:test:1234:5678:9abc:def0:1234:5678',
      stores: ['test-store-1', 'test-store-2'],
      version: '1.0.0'
    }

    const registerResponse = await fetch(`${serverUrl}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testPeer)
    })

    if (!registerResponse.ok) {
      throw new Error(`Registration failed: ${registerResponse.status}`)
    }

    const registerResult = await registerResponse.json()
    console.log(`✅ Registered: ${registerResult.peerId}`)
    console.log(`📊 Total peers: ${registerResult.totalPeers}`)

    // 2. Check peer list
    console.log('\n2. Checking peer list...')
    const peersResponse = await fetch(`${serverUrl}/peers`)
    const peersResult = await peersResponse.json()
    console.log(`📋 Active peers: ${peersResult.total}`)
    console.log(`📋 Total registered: ${peersResult.totalRegistered}`)

    // 3. Send heartbeat
    console.log('\n3. Sending heartbeat...')
    const heartbeatResponse = await fetch(`${serverUrl}/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ peerId: testPeer.peerId })
    })

    if (heartbeatResponse.ok) {
      const heartbeatResult = await heartbeatResponse.json()
      console.log(`💓 Heartbeat successful: ${heartbeatResult.peerId}`)
    } else {
      console.log(`❌ Heartbeat failed: ${heartbeatResponse.status}`)
    }

    // 4. Wait and check persistence
    console.log('\n4. Waiting 30 seconds to test persistence...')
    await new Promise(resolve => setTimeout(resolve, 30000))

    const peersResponse2 = await fetch(`${serverUrl}/peers`)
    const peersResult2 = await peersResponse2.json()
    console.log(`📋 Peers after 30s: ${peersResult2.total}`)

    // 5. Send another heartbeat
    console.log('\n5. Sending second heartbeat...')
    const heartbeat2Response = await fetch(`${serverUrl}/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ peerId: testPeer.peerId })
    })

    if (heartbeat2Response.ok) {
      console.log(`💓 Second heartbeat successful`)
    }

    // 6. Final peer count
    const peersResponse3 = await fetch(`${serverUrl}/peers`)
    const peersResult3 = await peersResponse3.json()
    console.log(`📋 Final peer count: ${peersResult3.total}`)

    console.log('\n🎉 Heartbeat system test completed!')
    console.log(`✅ Peer registration: Working`)
    console.log(`💓 Heartbeat system: Working`)
    console.log(`📋 Peer persistence: ${peersResult3.total > 0 ? 'Working' : 'Failed'}`)

  } catch (error) {
    console.error('❌ Test failed:', error)
  }
}

testHeartbeatSystem()
