# ERC-8004 Agent Trust Lookup — Base Mainnet

**Read-only agent identity and trust explorer on Base Mainnet.**

Queries the live ERC-8004 IdentityRegistry via cast-based event scanning. Mint events = registered agents. No writes. Pure on-chain data.

## Contract

| | |
|---|---|
| **IdentityRegistry** | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` |
| **Deployment block** | 41,799,769 |
| **RPC** | `https://mainnet.base.org` |

## Quick start

```bash
# Requires: cast (Foundry)
# npm install -g foundry

# Count all agents via Transfer events (mints)
node count-by-events-cast.js
```

## Scripts

| Script | Method | Notes |
|--------|--------|-------|
| `count-by-events-cast.js` | `cast logs` Transfer events | ✅ **Correct** — uses verified Transfer event signature |
| `count-by-events.js` | Raw RPC `eth_getLogs` | ⚠️ Fails with topic filters on some RPCs |
| `index.js` | `ownerOf()` batch RPC | ⚠️ Rate-limited, slow for large ranges |

## Verified agent count

```
🔍 ERC-8004 Cast-Based Count — Base Mainnet
Current block: 44,083,418
Deployment block: 41,799,769
Contract: 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432

[Cast logs — Transfer(address,address,uint256)]
Mints = topic[1] = address(0)
Burns = topic[2] = address(0)
```

**Cast-based scan running in background. See results in repo when complete.**

## Architecture

- **Cast-based event scan** — uses `cast logs` subprocess for reliable Transfer event counting
- **Transfer event** — `Transfer(address indexed from, address indexed to, uint256 indexed tokenId)`
- **Event signature** — `0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef` (verified 2026-03-31)
- **Batch size** — 9,000 blocks per query (stays under RPC 10,000 limit)
- **Requires** — Foundry (`cast`) installed at `~/.foundry/bin/cast`

## Bug history

- ~~`0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df35b9dc8`~~ — wrong event sig (bytes 26-32 wrong)
- ✅ `0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef` — correct (cast from contract)
