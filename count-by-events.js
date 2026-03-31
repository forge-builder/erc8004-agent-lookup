#!/usr/bin/env node

/**
 * ERC-8004 Agent Trust Lookup — Event-Based Counter
 * Uses eth_getLogs for Transfer events to count agents accurately
 * without rate-limiting issues that plague ownerOf() batch calls.
 *
 * Usage: NETWORK=mainnet node count-by-events.js
 */

const https = require('https');
const http = require('http');

const NETWORK = process.env.NETWORK || 'mainnet';
const RPC_URL = process.env.RPC_URL || (
  NETWORK === 'mainnet'
    ? 'https://mainnet.base.org'
    : 'https://base-sepolia.publicnode.com'
);

const IDENTITY_REGISTRY = NETWORK === 'mainnet'
  ? '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432'
  : '0x8004A818BFB912233c491871b3d84c89A494BD9e';

const NET_NAME = NETWORK === 'mainnet' ? 'Base Mainnet' : 'Base Sepolia';
const DEPLOYMENT_BLOCK = 41799769; // first mint of token 2046
const MAX_BLOCKS_PER_QUERY = 8000;  // stay under RPC limits

// ERC-721 Transfer event signature (correct — verified via cast logs 2026-03-31)
// keccak256("Transfer(address,address,uint256)")
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
// address(0) as topic[1] = from address (mints)
const FROM_ZERO_TOPIC = '0x0000000000000000000000000000000000000000000000000000000000000000';
// address(0) as topic[2] = to address (burns)
const TO_ZERO_TOPIC   = '0x0000000000000000000000000000000000000000000000000000000000000000';

const TIMEOUT = 30000;

function rpcCall(method, params = []) {
  return new Promise((resolve) => {
    const client = RPC_URL.startsWith('https') ? https : http;
    const parsed = new URL(RPC_URL);
    const start = Date.now();
    const req = client.request({
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        const latency = Date.now() - start;
        try {
          resolve({ success: true, latency, data: JSON.parse(data) });
        } catch (e) {
          resolve({ success: false, latency, error: e.message });
        }
      });
    });
    req.on('error', e => resolve({ success: false, latency: Date.now() - start, error: e.message }));
    req.setTimeout(TIMEOUT, () => { req.destroy(); resolve({ success: false, latency: TIMEOUT, error: 'Timeout' }); });
    req.write(JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }));
    req.end();
  });
}

function hexToInt(hex) {
  if (!hex || hex === '0x') return 0;
  return parseInt(hex, 16);
}

async function getBlockNumber() {
  const r = await rpcCall('eth_blockNumber');
  return r.success ? hexToInt(r.data.result) : null;
}

async function getLogs(fromBlock, toBlock) {
  return rpcCall('eth_getLogs', [{
    fromBlock: '0x' + fromBlock.toString(16),
    toBlock:   '0x' + toBlock.toString(16),
    address:   IDENTITY_REGISTRY,
    topics:    [TRANSFER_TOPIC],
    limit:    10000,
  }]);
}

function parseTransferCount(logs) {
  let mints = 0, burns = 0;
  if (!logs || !logs.data?.result) return { mints: 0, burns: 0 };
  const entries = Array.isArray(logs.data.result) ? logs.data.result : [logs.data.result];
  for (const log of entries) {
    if (!log.topics || log.topics.length < 3) continue;
    const from = log.topics[1];
    const to   = log.topics[2];
    if (from === FROM_ZERO_TOPIC) mints++;
    if (to   === TO_ZERO_TOPIC)   burns++;
  }
  return { mints, burns };
}

async function main() {
  console.log(`\n🔍 ERC-8004 Event-Based Agent Count — ${NET_NAME}`);
  console.log('══════════════════════════════════════════════════════\n');

  const currentBlock = await getBlockNumber();
  if (!currentBlock) {
    console.error('❌ Could not fetch current block number');
    process.exit(1);
  }
  console.log(`Current block: ${currentBlock.toLocaleString()}`);
  console.log(`Deployment block: ${DEPLOYMENT_BLOCK.toLocaleString()}`);
  console.log(`RPC: ${RPC_URL}\n`);

  let totalMints = 0, totalBurns = 0;
  let fromBlock = DEPLOYMENT_BLOCK;
  let queryCount = 0;
  const blockRanges = [];

  process.stdout.write('Scanning Transfer events...\n');

  while (fromBlock < currentBlock) {
    const toBlock = Math.min(fromBlock + MAX_BLOCKS_PER_QUERY, currentBlock);
    const logs = await getLogs(fromBlock, toBlock);
    queryCount++;

    if (!logs.success) {
      console.log(`\n   ⚠ Block ${fromBlock.toLocaleString()}–${toBlock.toLocaleString()}: ${logs.error} (retrying)`);
      // retry once with smaller range
      const retryLogs = await getLogs(fromBlock, Math.min(fromBlock + 1000, currentBlock));
      if (retryLogs.success && retryLogs.data?.result) {
        const { mints, burns } = parseTransferCount(retryLogs);
        totalMints += mints;
        totalBurns += burns;
        if (mints > 0 || burns > 0) {
          blockRanges.push({ from: fromBlock, to: fromBlock + 1000, mints, burns });
        }
      }
      fromBlock += 1001;
      continue;
    }

    const { mints, burns } = parseTransferCount(logs);
    totalMints += mints;
    totalBurns += burns;

    if (blockRanges.length < 50 || mints > 0 || burns > 0) {
      blockRanges.push({ from: fromBlock, to: toBlock, mints, burns });
    }

    fromBlock = toBlock + 1;

    // Progress indicator every 20 queries
    if (queryCount % 20 === 0) {
      process.stdout.write(`  [q${queryCount}] blocks ${fromBlock.toLocaleString()}/${currentBlock.toLocaleString()} — mints: ${totalMints} burns: ${totalBurns}\n`);
    }
  }

  const totalAgents = totalMints - totalBurns;

  console.log('\n══════════════════════════════════════════════════════');
  console.log(`Scan complete — ${queryCount} RPC queries`);
  console.log(`Total Mint events:    ${totalMints.toLocaleString()}`);
  console.log(`Total Burn events:    ${totalBurns.toLocaleString()}`);
  console.log(`Net registered agents: ${totalAgents.toLocaleString()}`);
  console.log(`Current block:         ${currentBlock.toLocaleString()}`);
  console.log(`Network:              ${NET_NAME}`);
  console.log(`IdentityRegistry:     ${IDENTITY_REGISTRY}`);
  console.log(`Timestamp:            ${new Date().toISOString()}`);
  console.log('══════════════════════════════════════════════════════\n');

  // Sample of active ranges
  if (blockRanges.length > 0) {
    const active = blockRanges.filter(r => r.mints > 0 || r.burns > 0).slice(-20);
    console.log('Sample active ranges (last 20):');
    for (const r of active) {
      console.log(`  blocks ${r.from.toLocaleString()}–${r.to.toLocaleString()}: +${r.mints} mints, -${r.burns} burns`);
    }
  }

  return {
    timestamp: new Date().toISOString(),
    network: NET_NAME,
    currentBlock,
    deploymentBlock: DEPLOYMENT_BLOCK,
    identityRegistry: IDENTITY_REGISTRY,
    totalMints,
    totalBurns,
    totalAgents,
    rpcQueries: queryCount,
  };
}

main()
  .then(r => {
    console.log('\n--- JSON OUTPUT ---');
    console.log(JSON.stringify(r, null, 2));
  })
  .catch(e => { console.error('Fatal:', e.message); process.exit(1); });
