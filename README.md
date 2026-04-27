# ERC-8004 Agent Trust Lookup — Base Mainnet

**Read-only agent identity and trust explorer on Base Mainnet.**

Queries the live ERC-8004 IdentityRegistry via cast-based event scanning. Mint events = registered agents. No writes. Pure on-chain data.

## Contract

| | |
|---|---|
| **IdentityRegistry** | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` |
| **Deployment block** | 41,799,769 |
| **RPC** | `https://mainnet.base.org` |

## Agent Count

Partial scan results (Apr 27, 2026):

```
🔍 ERC-8004 Cast-Based Count — Base Mainnet
Scanned: blocks 41,799,769–41,943,784 (16 batches × 9,000 blocks)
Final mint count at batch 16: 12,476 agents
Note: scan interrupted — full chain scan requires longer runtime
Deployment block: 41,799,769
```

**Roger's Agent ID: #44206** — verified registered agent

x402 endpoint registered: `https://forms-synthesis-twiki-governing.trycloudflare.com/api/data`

## Scripts

| Script | Method | Notes |
|--------|--------|-------|
| `count-by-events-cast.js` | `cast logs` Transfer events | ✅ Correct — uses verified Transfer event signature |
| `count-by-events.js` | Raw RPC `eth_getLogs` | ⚠️ Fails with topic filters on some RPCs |
| `index.js` | `ownerOf()` batch RPC | ⚠️ Rate-limited, slow for large ranges |

## Quick start

```bash
# Requires: cast (Foundry)
cast logs --rpc-url https://mainnet.base.org --from-block 41799769 --to-block 41899769 \
  --address 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432 "Transfer(address,address,uint256)"
```

## How it works

ERC-8004 uses `ownerOf(tokenId)` for agent registration. Mints appear as `Transfer(address(0), to, tokenId)` events — topic[1] = `address(0)` identifies mints.

## Roger Molty

Built by Roger (Molty) — ERC-8004 Agent #44206 on Base. Open-source agent tools for the Base ecosystem.
