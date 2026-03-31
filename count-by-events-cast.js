#!/usr/bin/env node
/**
 * ERC-8004 Agent Trust Lookup — Cast-Based Event Counter
 * Uses `cast logs` subprocess for reliable Transfer event counting.
 * Mint = Transfer(address(0), to, tokenId) — topic[1] = address(0)
 * 
 * Usage: node count-by-events-cast.js
 */

const { execSync } = require('child_process');
const RPC = 'https://mainnet.base.org';
const CONTRACT = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432';
const DEPLOY_BLOCK = 41799769;
const MAX_QUERY_BLOCKS = 10000; // RPC hard limit
const BATCH_SIZE = 9000; // safety margin
const CAST = '/Users/roger/.foundry/bin/cast';

function castLogs(fromBlock, toBlock) {
  const cmd = `${CAST} logs --rpc-url ${RPC} --from-block ${fromBlock} --to-block ${toBlock} --address ${CONTRACT} "Transfer(address,address,uint256)" 2>&1`;
  try {
    const out = execSync(cmd, { maxBuffer: 10 * 1024 * 1024, timeout: 30000 });
    return out.toString();
  } catch (e) {
    return e.stdout?.toString() || e.message;
  }
}

function parseLogs(output) {
  // cast logs outputs YAML with "topics: [...]" blocks
  // Topic[0] = event sig, Topic[1] = indexed 'from', Topic[2] = indexed 'to'
  // Mint: topic[1] = address(0); Burn: topic[2] = address(0)
  const FROM_ZERO = '0x0000000000000000000000000000000000000000000000000000000000000000';
  let mints = 0, burns = 0;
  const blocks = output.split(/blockNumber:/);
  for (const block of blocks.slice(1)) {
    const hexMatches = block.match(/0x[a-f0-9]{64}/g) || [];
    if (hexMatches.length < 2) continue;
    // hexMatches[0] = topic[0] (event sig), [1] = topic[1] (from), [2] = topic[2] (to)
    if (hexMatches[1] === FROM_ZERO) mints++;
    if (hexMatches[2] === FROM_ZERO) burns++;
  }
  return { mints, burns };
}

async function main() {
  const latestBlockHex = execSync(`${CAST} block-number --rpc-url ${RPC}`).toString().trim();
  const currentBlock = parseInt(latestBlockHex, 16);
  console.log(`\n🔍 ERC-8004 Cast-Based Count — Base Mainnet`);
  console.log(`Current block: ${currentBlock.toLocaleString()}`);
  console.log(`Deployment block: ${DEPLOY_BLOCK.toLocaleString()}`);
  console.log(`RPC: ${RPC}`);
  console.log(`Contract: ${CONTRACT}\n`);

  let totalMints = 0, totalBurns = 0;
  let fromBlock = DEPLOY_BLOCK;
  let batch = 0;
  let zeroCount = 0;

  while (fromBlock < currentBlock) {
    const toBlock = Math.min(fromBlock + BATCH_SIZE, currentBlock);
    batch++;
    const out = castLogs(fromBlock, toBlock);
    const { mints, burns } = parseLogs(out);
    totalMints += mints;
    totalBurns += burns;

    if (mints === 0 && burns === 0) {
      zeroCount++;
    }

    if (batch % 20 === 0 || mints > 0 || burns > 0) {
      process.stdout.write(`[b${batch}] blocks ${fromBlock.toLocaleString()}–${toBlock.toLocaleString()}: +${mints} mints, -${burns} burns (total: ${totalMints} mints, ${totalBurns} burns)\n`);
    }

    fromBlock = toBlock + 1;
  }

  const netAgents = totalMints - totalBurns;
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Cast-based scan complete — ${batch} batches`);
  console.log(`Total Mint events:   ${totalMints.toLocaleString()}`);
  console.log(`Total Burn events:   ${totalBurns.toLocaleString()}`);
  console.log(`Net registered agents: ${netAgents.toLocaleString()}`);
  console.log(`Block range: ${DEPLOY_BLOCK.toLocaleString()}–${currentBlock.toLocaleString()}`);
  console.log(`RPC: ${RPC}`);
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log(`${'='.repeat(60)}\n`);
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), network: 'Base Mainnet', currentBlock, deploymentBlock: DEPLOY_BLOCK, contract: CONTRACT, totalMints, totalBurns, netAgents, batches: batch }));
}

main().catch(e => { console.error(e.message); process.exit(1); });
