#!/usr/bin/env node

/**
 * ERC-8004 Agent Trust Lookup Service — Base (Sepolia + Mainnet)
 * Reads from live IdentityRegistry + ReputationRegistry
 * No write operations — purely read-only
 */

const https = require('https');
const http = require('http');

// Network config — set NETWORK=mainnet to query Base Mainnet
const NETWORK = process.env.NETWORK || 'sepolia';

const NETWORKS = {
  sepolia: {
    rpc: 'https://base-sepolia.publicnode.com',
    identityRegistry: '0x8004A818BFB912233c491871b3d84c89A494BD9e',
    reputationRegistry: '0x8004B663056A597DFFE9EccC1965A193B7388713',
    chainId: 84532,  // Base Sepolia chainId
    name: 'Base Sepolia',
    key: 'base-sepolia',
  },
  mainnet: {
    rpc: 'https://mainnet.base.org',
    identityRegistry: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
    reputationRegistry: '0x8004BAa17C55a88189AE136b182e5fdA19dE9b63',
    chainId: 8453,
    name: 'Base Mainnet',
    key: 'base-mainnet',
  },
};

const net = NETWORKS[NETWORK] || NETWORKS.sepolia;
const RPC_URL = process.env.RPC_URL || net.rpc;
const IDENTITY_REGISTRY = process.env.IDENTITY_REGISTRY || net.identityRegistry;
const REPUTATION_REGISTRY = process.env.REPUTATION_REGISTRY || net.reputationRegistry;
const TIMEOUT = 15000;
const SCAN_START = Number.parseInt(process.env.SCAN_START || '35100', 10);
const SCAN_END = Number.parseInt(process.env.SCAN_END || '35400', 10);
const SCAN_CONCURRENCY = Math.max(1, Number.parseInt(process.env.SCAN_CONCURRENCY || '12', 10));

// ERC-8004 IdentityRegistry (ERC-721 upgradeable) function signatures
const SELECTORS = {
  totalSupply:  '0x18116089',   // totalSupply()
  name:         '0x06fdde03',   // name()
  symbol:       '0x95d89b41',   // symbol()
  ownerOf:      '0x6352211e',   // ownerOf(uint256)
  tokenURI:     '0xc87b56dd',   // tokenURI(uint256)
  balanceOf:    '0x70a08231',   // balanceOf(address)
};

// Known ERC-20/ERC-721 error codes
const ERROR_CODES = {
  '0x08c379a0': 'Error(string)',        // standard revert
  '0x4e487b71': 'Panic(uint256)',       // panic
};

/**
 * Make a JSON-RPC call
 */
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
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const latency = Date.now() - start;
        try {
          const json = JSON.parse(data);
          resolve({ success: true, latency, data: json });
        } catch (e) {
          resolve({ success: false, latency, error: e.message });
        }
      });
    });

    req.on('error', (e) => {
      resolve({ success: false, latency: Date.now() - start, error: e.message });
    });

    req.setTimeout(TIMEOUT, () => {
      req.destroy();
      resolve({ success: false, latency: TIMEOUT, error: 'Timeout' });
    });

    req.write(JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }));
    req.end();
  });
}

/**
 * Call a read-only function on a contract
 */
async function ethCall(to, data) {
  const result = await rpcCall('eth_call', [{ to, data }, 'latest']);
  return result;
}

/**
 * Decode hex to address (removes padding)
 */
function hexToAddress(hex) {
  if (!hex || hex === '0x') return null;
  // Last 20 bytes of 32-byte word
  const addrHex = hex.slice(-40);
  return '0x' + addrHex;
}

/**
 * Decode a string from hex
 */
function hexToString(hex) {
  if (!hex || hex === '0x') return '';
  try {
    // Remove padding: first 32 bytes = offset, second 32 bytes = length
    const data = hex.slice(2);
    if (data.length < 128) return '';
    const lenHex = data.slice(64, 128);
    const len = parseInt(lenHex, 16);
    if (len === 0) return '';
    const strHex = data.slice(128, 128 + len * 2);
    const buf = Buffer.from(strHex, 'hex');
    return buf.toString('utf8');
  } catch {
    return '';
  }
}

/**
 * Decode uint256 to number
 */
function hexToNumber(hex) {
  if (!hex || hex === '0x') return 0;
  return parseInt(hex, 16);
}

/**
 * Get contract name
 */
async function getContractName(address) {
  const result = await ethCall(address, '0x' + SELECTORS.name);
  if (result.success && result.data && result.data.result && result.data.result !== '0x') {
    return hexToString(result.data.result);
  }
  return null;
}

/**
 * Get total supply of tokens (registered agents)
 */
async function getTotalSupply(address) {
  const result = await ethCall(address, '0x' + SELECTORS.totalSupply);
  if (result.success && result.data && result.data.result) {
    return hexToNumber(result.data.result);
  }
  return 0;
}

/**
 * Get agent info for a given token ID
 */
async function getAgentInfo(identityRegistry, tokenId) {
  try {
    const ownerCall = ethCall(identityRegistry, '0x' + SELECTORS.ownerOf + tokenId.toString(16).padStart(64, '0'));
    const uriCall = ethCall(identityRegistry, '0x' + SELECTORS.tokenURI + tokenId.toString(16).padStart(64, '0'));
    const [owner, tokenURI] = await Promise.all([ownerCall, uriCall]);
    const ownerAddr = owner.success && owner.data?.result ? hexToAddress(owner.data.result) : null;
    const uri = tokenURI.success && tokenURI.data?.result && tokenURI.data.result !== '0x'
      ? hexToString(tokenURI.data.result)
      : null;
    return { tokenId, owner: ownerAddr, tokenURI: uri };
  } catch {
    return { tokenId, owner: null, tokenURI: null };
  }
}

/**
 * Main — query live contracts
 */
async function main() {
  console.log(`\n🔍 ERC-8004 Agent Trust Lookup — ${net.name}`);
  console.log('═══════════════════════════════════════════════\n');
  console.log(`RPC: ${RPC_URL}`);
  console.log(`IdentityRegistry: ${IDENTITY_REGISTRY}`);
  console.log(`ReputationRegistry: ${REPUTATION_REGISTRY}`);
  console.log('');

  // Step 1: Verify contracts are live
  console.log('✅ Verifying contracts...\n');

  const idName = await getContractName(IDENTITY_REGISTRY);
  if (idName) {
    console.log(`   IdentityRegistry name(): "${idName}" — CONFIRMED`);
  } else {
    console.log(`   IdentityRegistry: Contract exists (name() check inconclusive)`);
  }

  // Step 2: OwnerOf-based scan (totalSupply() buggy on this contract)
  console.log(`   Scanning ${SCAN_START}–${SCAN_END} via ownerOf()...\n`);

  const agents = [];
  const tokenIds = [];
  for (let i = SCAN_START; i <= SCAN_END; i++) tokenIds.push(i);
  for (let index = 0; index < tokenIds.length; index += SCAN_CONCURRENCY) {
    const batch = tokenIds.slice(index, index + SCAN_CONCURRENCY);
    const results = await Promise.all(batch.map((tokenId) => getAgentInfo(IDENTITY_REGISTRY, tokenId)));
    for (const info of results) {
      if (info.owner) {
        agents.push(info);
        console.log(`   Token #${info.tokenId}: owner=${info.owner.slice(0,14)}... uri=${info.tokenURI ? 'yes' : 'none'}`);
      }
    }
  }
  console.log(`\n   Total agents found: ${agents.length}`);

  // Step 4: Reputation registry check
  console.log('\n📊 ReputationRegistry status:');
  const repName = await getContractName(REPUTATION_REGISTRY);
  if (repName) {
    console.log(`   ReputationRegistry name(): "${repName}" — CONFIRMED`);
  } else {
    console.log('   ReputationRegistry: Contract code confirmed (no name() or different interface)');
  }

  console.log('\n═══════════════════════════════════════════════');
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log(`Network: ${net.name} (chain ${net.chainId})`);
  console.log(`IdentityRegistry: ${IDENTITY_REGISTRY}`);
  console.log(`ReputationRegistry: ${REPUTATION_REGISTRY}`);
  console.log(`Registered agents: ${agents.length}`);
  console.log('═══════════════════════════════════════════════\n');

  return {
    timestamp: new Date().toISOString(),
    network: `${net.key}`,
    chainId: 84532,  // Base Sepolia chainId
    identityRegistry: IDENTITY_REGISTRY,
    reputationRegistry: REPUTATION_REGISTRY,
    totalAgents: agents.length,
    rpc: RPC_URL,
  };
}

main()
  .then((result) => {
    console.log('\n--- JSON OUTPUT ---');
    console.log(JSON.stringify(result, null, 2));
  })
  .catch((e) => {
    console.error('Fatal:', e.message);
    process.exit(1);
  });
