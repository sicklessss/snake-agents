import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useConnect, useDisconnect, useSignMessage, useSendTransaction, useSwitchChain, createConfig, http as wagmiHttp } from 'wagmi';
import { injected, metaMask, coinbaseWallet } from 'wagmi/connectors';
import { parseEther, parseUnits, stringToHex, padHex, createPublicClient, http } from 'viem';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider } from 'wagmi';
import { baseSepolia } from 'wagmi/chains';
import './index.css';
import { CONTRACTS, BOT_REGISTRY_ABI, PARI_MUTUEL_ABI, ERC20_ABI, BOT_MARKETPLACE_ABI, SNAKE_BOT_NFT_ABI } from './contracts';
import foodSvgUrl from './assets/food.svg';

// --- CONFIG (multi-wallet, no WalletConnect dependency) ---
const config = createConfig({
  chains: [baseSepolia],
  connectors: [
    injected(),
    metaMask(),
    coinbaseWallet({ appName: 'Snake Agents' }),
  ],
  multiInjectedProviderDiscovery: true,
  transports: { [baseSepolia.id]: wagmiHttp('https://sepolia.base.org') },
});

const queryClient = new QueryClient();

const publicClient = createPublicClient({ chain: baseSepolia, transport: http('https://sepolia.base.org') });


const PERFORMANCE_RULES = `游戏介绍

Snake Agents 是一个实时多人贪吃蛇竞技场，玩家或AI bot在同一张地图中比拼生存与吞噬。

规则概览

1) 地图与节奏
- 地图：30×30
- 回合：125ms/次（约8FPS）
- 每局：180秒
- 食物上限：5个

2) 出生与移动
- 固定出生点，初始长度=3
- 不能立刻反向

3) 死亡
- 撞墙 / 自撞 / 撞尸体：死亡

4) 蛇对蛇
- 头对头：更长者生存；同长同死
- 头撞到别人身体：更长者"吃掉"对方一段；更短者死亡

5) 胜负
- 仅剩1条：胜 | 全灭：No Winner | 时间到：最长者胜
`;

const COMPETITIVE_RULES = `⚔️ 竞技场规则

竞技场是高级赛场，只有已注册的 Agent Bot 才能参赛。

与表演场的不同：
🧱 障碍物系统
- 比赛期间每10秒随机生成障碍物（1×1 ~ 4×4 不规则形状）
- 障碍物生成时闪烁2秒（黄色闪烁），此时可以穿越
- 闪烁结束后变为实体障碍（红色），蛇撞上即死

💰 进场机制
- 默认：系统随机从已注册 Agent Bot 中挑选上场
- 付费进场：支付 0.001 ETH 可选择指定场次上场
- 付费进场的 bot 该场结束后回到随机挑选状态

📋 基础规则同表演场
- 5秒赛前准备 → 3分钟比赛 → 5秒休息
- 30×30 地图 | 125ms/tick | 食物上限5个
`;

// Helper: encode bot name to bytes32
function nameToBytes32(name: string): `0x${string}` {
  return stringToHex(name, { size: 32 });
}

// Helper: estimate gas via our own RPC (fixes OKX wallet grayed-out confirm button)
// OKX wallet can't estimate gas on Base Sepolia internally, so we pre-estimate
// and pass the gas value explicitly. This makes the confirm button clickable.
async function estimateGas(params: {
  address: `0x${string}`;
  abi: any;
  functionName: string;
  args: any[];
  value?: bigint;
  account: `0x${string}`;
}): Promise<bigint | undefined> {
  try {
    const gas = await publicClient.estimateContractGas({
      address: params.address,
      abi: params.abi,
      functionName: params.functionName,
      args: params.args,
      value: params.value,
      account: params.account,
    });
    // Add 30% buffer for safety
    return gas + (gas * 3n / 10n);
  } catch (e) {
    console.warn('[estimateGas] Failed, wallet will estimate:', e);
    return undefined;
  }
}

// --- COMPONENTS ---

// Wallet icons (inline SVG data URIs)
const WALLET_ICONS: Record<string, string> = {
  metaMask: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="8" fill="#F6851B"/><text x="20" y="26" text-anchor="middle" font-size="20" fill="white">M</text></svg>'),
  coinbaseWallet: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="8" fill="#0052FF"/><text x="20" y="26" text-anchor="middle" font-size="20" fill="white">C</text></svg>'),
  injected: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="8" fill="#627EEA"/><text x="20" y="26" text-anchor="middle" font-size="20" fill="white">W</text></svg>'),
};

function getWalletIcon(id: string) {
  if (id.toLowerCase().includes('metamask')) return WALLET_ICONS.metaMask;
  if (id.toLowerCase().includes('coinbase')) return WALLET_ICONS.coinbaseWallet;
  return WALLET_ICONS.injected;
}

function getWalletDisplayName(connector: { id: string; name: string }) {
  if (connector.id.toLowerCase().includes('metamask') || connector.name.toLowerCase().includes('metamask')) return 'MetaMask';
  if (connector.id.toLowerCase().includes('coinbase') || connector.name.toLowerCase().includes('coinbase')) return 'Coinbase Wallet';
  if (connector.id === 'injected') return 'Browser Wallet';
  return connector.name;
}

// Wallet connection button + modal selector
function WalletButton() {
  const { address, isConnected, chain } = useAccount();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();
  const { writeContractAsync } = useWriteContract();
  const { switchChainAsync } = useSwitchChain();
  const [showModal, setShowModal] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [claimable, setClaimable] = useState<{ matchId: number; winnings: string; winningsWei: string }[]>([]);
  const [claimTotal, setClaimTotal] = useState('0');
  const [claiming, setClaiming] = useState(false);
  const [claimStatus, setClaimStatus] = useState('');

  // Fetch claimable winnings when menu opens
  useEffect(() => {
    if (!showMenu || !address) return;
    setClaimStatus('');
    fetch(`/api/pari-mutuel/claimable?address=${address}`)
      .then(r => r.json())
      .then(data => {
        setClaimable(data.claimable || []);
        setClaimTotal(data.total || '0');
      })
      .catch(() => { setClaimable([]); setClaimTotal('0'); });
  }, [showMenu, address]);

  const handleClaim = async () => {
    if (!claimable.length || claiming) return;
    if (chain?.id !== baseSepolia.id) {
      try { await switchChainAsync({ chainId: baseSepolia.id }); } catch { setClaimStatus('Please switch to Base Sepolia'); return; }
    }
    setClaiming(true);
    setClaimStatus('Claiming...');
    let claimed = 0;
    for (const item of claimable) {
      try {
        const claimGas = await estimateGas({
          address: CONTRACTS.pariMutuel as `0x${string}`,
          abi: PARI_MUTUEL_ABI,
          functionName: 'claimWinnings',
          args: [BigInt(item.matchId)],
          account: address as `0x${string}`,
        });
        await writeContractAsync({
          address: CONTRACTS.pariMutuel as `0x${string}`,
          abi: PARI_MUTUEL_ABI,
          functionName: 'claimWinnings',
          args: [BigInt(item.matchId)],
          chainId: baseSepolia.id,
          ...(claimGas ? { gas: claimGas } : {}),
        });
        claimed++;
        setClaimStatus(`Claimed ${claimed}/${claimable.length}...`);
      } catch (e: any) {
        const msg = e?.shortMessage || e?.message || '';
        if (msg.includes('rejected') || msg.includes('denied')) {
          setClaimStatus('Cancelled');
          setClaiming(false);
          return;
        }
        // Skip this match, continue with others
        setClaimStatus(`Match #${item.matchId} failed, continuing...`);
      }
    }
    setClaiming(false);
    setClaimStatus(claimed > 0 ? `Claimed ${claimed} match(es)!` : 'No claims succeeded');
    // Refresh claimable list
    if (address) {
      fetch(`/api/pari-mutuel/claimable?address=${address}`)
        .then(r => r.json())
        .then(data => { setClaimable(data.claimable || []); setClaimTotal(data.total || '0'); })
        .catch(() => {});
    }
  };

  // De-duplicate connectors by display name
  const uniqueConnectors = connectors.reduce<typeof connectors>((acc, c) => {
    const name = getWalletDisplayName(c);
    if (!acc.find(x => getWalletDisplayName(x) === name)) acc.push(c);
    return acc;
  }, []);

  if (isConnected && address) {
    return (
      <div style={{ position: 'relative' }}>
        <button
          onClick={() => setShowMenu(!showMenu)}
          style={{
            padding: '6px 12px', fontSize: '0.8rem', borderRadius: '8px',
            background: 'rgba(0,255,136,0.15)', color: 'var(--neon-green)',
            border: '1px solid var(--neon-green)', cursor: 'pointer',
            fontFamily: 'Orbitron, monospace', fontWeight: 'bold',
            display: 'flex', alignItems: 'center', gap: '6px',
          }}
        >
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--neon-green)', display: 'inline-block' }} />
          {address.slice(0, 6)}...{address.slice(-4)}
        </button>
        {showMenu && (
          <>
            <div onClick={() => setShowMenu(false)} style={{ position: 'fixed', inset: 0, zIndex: 9998 }} />
            <div style={{
              position: 'absolute', top: '100%', right: 0, marginTop: 6,
              background: '#0f0f25', border: '1px solid #2a2a4a', borderRadius: 10,
              padding: 8, minWidth: 180, zIndex: 9999,
              boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
            }}>
              <div style={{ padding: '6px 10px', fontSize: '0.75rem', color: 'var(--text-dim)', borderBottom: '1px solid #1b1b3b', marginBottom: 4 }}>
                Base Sepolia
              </div>
              <button
                onClick={() => { navigator.clipboard.writeText(address); setShowMenu(false); }}
                style={{
                  width: '100%', padding: '8px 10px', background: 'transparent', color: '#fff',
                  border: 'none', cursor: 'pointer', fontFamily: 'Orbitron, monospace',
                  fontSize: '0.75rem', textAlign: 'left', borderRadius: 6,
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.08)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                Copy Address
              </button>
              {/* Claim USDC winnings section */}
              <div style={{ borderTop: '1px solid #1b1b3b', margin: '4px 0', padding: '6px 10px' }}>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)', marginBottom: 4 }}>
                  Claimable: <span style={{ color: parseFloat(claimTotal) > 0 ? 'var(--neon-green)' : '#fff' }}>{claimTotal} USDC</span>
                </div>
                {parseFloat(claimTotal) > 0 && (
                  <button
                    onClick={handleClaim}
                    disabled={claiming}
                    style={{
                      width: '100%', padding: '6px 10px', borderRadius: 6,
                      background: claiming ? '#333' : 'var(--neon-green)',
                      color: claiming ? '#888' : '#000', border: 'none',
                      cursor: claiming ? 'not-allowed' : 'pointer',
                      fontFamily: 'Orbitron, monospace', fontSize: '0.7rem', fontWeight: 'bold',
                    }}
                  >
                    {claiming ? 'Claiming...' : `Claim ${claimTotal} USDC`}
                  </button>
                )}
                {claimStatus && (
                  <div style={{ fontSize: '0.65rem', color: 'var(--neon-blue)', marginTop: 3 }}>{claimStatus}</div>
                )}
              </div>
              <button
                onClick={() => { disconnect(); setShowMenu(false); }}
                style={{
                  width: '100%', padding: '8px 10px', background: 'transparent', color: '#ff4466',
                  border: 'none', cursor: 'pointer', fontFamily: 'Orbitron, monospace',
                  fontSize: '0.75rem', textAlign: 'left', borderRadius: 6,
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,0,68,0.1)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                Disconnect
              </button>
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <>
      <button
        onClick={() => setShowModal(true)}
        style={{
          padding: '8px 16px', fontSize: '0.85rem', borderRadius: '8px',
          background: 'var(--neon-green)', color: '#000',
          border: 'none', cursor: 'pointer',
          fontFamily: 'Orbitron, monospace', fontWeight: 'bold',
        }}
      >
        Connect Wallet
      </button>
      {showModal && (
        <div
          onClick={() => setShowModal(false)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 99999,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: '#0f0f25', border: '1px solid #2a2a4a', borderRadius: 16,
              padding: '24px', width: 340, maxWidth: '90vw',
              boxShadow: '0 16px 64px rgba(0,0,0,0.8)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h3 style={{ margin: 0, fontSize: '1rem', color: '#fff' }}>Connect Wallet</h3>
              <button
                onClick={() => setShowModal(false)}
                style={{
                  background: 'transparent', border: 'none', color: '#888',
                  fontSize: '1.2rem', cursor: 'pointer', padding: '4px 8px',
                  width: 'auto', minWidth: 0,
                }}
              >
                ✕
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {uniqueConnectors.map(connector => (
                <button
                  key={connector.uid}
                  onClick={() => {
                    connect({ connector });
                    setShowModal(false);
                  }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '12px 14px', borderRadius: 10,
                    background: 'rgba(255,255,255,0.05)', border: '1px solid #2a2a4a',
                    color: '#fff', cursor: 'pointer', fontFamily: 'Orbitron, monospace',
                    fontSize: '0.85rem', fontWeight: 'bold', transition: 'all 0.15s',
                    width: '100%',
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.background = 'rgba(0,255,136,0.1)';
                    e.currentTarget.style.borderColor = 'var(--neon-green)';
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
                    e.currentTarget.style.borderColor = '#2a2a4a';
                  }}
                >
                  <img src={getWalletIcon(connector.id)} alt="" width={32} height={32} style={{ borderRadius: 6 }} />
                  {getWalletDisplayName(connector)}
                </button>
              ))}
            </div>
            <p style={{ margin: '16px 0 0', fontSize: '0.7rem', color: 'var(--text-dim)', textAlign: 'center' }}>
              Choose a wallet to connect to Snake Agents
            </p>
          </div>
        </div>
      )}
    </>
  );
}

// Issue 1: Bot Management with 5 slots, scrollable
function BotManagement() {
  const { isConnected, address, chain } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const { signMessageAsync } = useSignMessage();
  const { switchChainAsync } = useSwitchChain();
  const [bots, setBots] = useState<any[]>([]);
  const [newName, setNewName] = useState('');
  const [regStatus, setRegStatus] = useState('');
  const [copied, setCopied] = useState(false);
  const [sellBot, setSellBot] = useState<any>(null);
  const [sellPrice, setSellPrice] = useState('');
  const [sellStatus, setSellStatus] = useState('');
  const [sellBusy, setSellBusy] = useState(false);
  // Edit modal state
  const [editBot, setEditBot] = useState<any>(null);
  const [editCode, setEditCode] = useState('');
  const [editToken, setEditToken] = useState('');
  const [editStatus, setEditStatus] = useState('');
  const [editBusy, setEditBusy] = useState(false);
  const miscTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [regHash, setRegHash] = useState<`0x${string}` | undefined>(undefined);
  const [regPending, setRegPending] = useState(false);
  const [regError, setRegError] = useState<Error | null>(null);
  const { isLoading: regConfirming, isSuccess: regConfirmed } = useWaitForTransactionReceipt({ hash: regHash });

  const guideUrl = window.location.origin + '/SNAKE_GUIDE.md';

  const handleCopy = () => {
    const doCopy = (text: string) => {
      if (navigator.clipboard && window.isSecureContext) {
        return navigator.clipboard.writeText(text);
      }
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      return Promise.resolve();
    };
    doCopy(guideUrl).then(() => {
      setCopied(true);
      if (miscTimerRef.current) clearTimeout(miscTimerRef.current); miscTimerRef.current = setTimeout(() => setCopied(false), 2000);
    });
  };

  // Edit: request signature, get edit token, load code
  const handleEditOpen = async (bot: any) => {
    if (!isConnected || !address) return alert('Connect Wallet first');
    setEditBot(bot);
    setEditCode('');
    setEditToken('');
    setEditStatus('Requesting wallet signature...');
    setEditBusy(true);
    try {
      const timestamp = Date.now().toString();
      const message = `Snake Agents Edit: ${bot.botId} at ${timestamp}`;
      const signature = await signMessageAsync({ message });

      setEditStatus('Verifying NFT ownership...');
      const res = await fetch('/api/bot/edit-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ botId: bot.botId, address, signature, timestamp }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.error === 'not_nft_owner') {
          setEditStatus('You do not own the NFT for this bot');
        } else {
          setEditStatus(data.message || data.error || 'Failed to get edit token');
        }
        setEditBusy(false);
        return;
      }

      setEditToken(data.token);
      setEditStatus('Loading bot code...');
      const codeRes = await fetch(`/api/bot/${bot.botId}/code`, {
        headers: { 'x-edit-token': data.token },
      });
      if (codeRes.ok) {
        const codeData = await codeRes.json();
        setEditCode(codeData.code || '');
        setEditStatus('');
      } else {
        const errData = await codeRes.json();
        setEditCode('');
        setEditStatus(errData.message || 'No code found — write your bot code below');
      }
    } catch (e: any) {
      setEditStatus(e?.message || 'Error');
    }
    setEditBusy(false);
  };

  // Save edited code
  const handleEditSave = async () => {
    if (!editBot || !editToken) return;
    setEditBusy(true);
    setEditStatus('Saving...');
    try {
      const res = await fetch(`/api/bot/upload?botId=${editBot.botId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/javascript', 'x-edit-token': editToken },
        body: editCode,
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setEditStatus('Saved! Bot restarting...');
        if (miscTimerRef.current) clearTimeout(miscTimerRef.current); miscTimerRef.current = setTimeout(() => { setEditBot(null); setEditCode(''); setEditToken(''); setEditStatus(''); }, 1500);
      } else {
        setEditStatus(data.message || data.error || 'Save failed');
      }
    } catch (e: any) {
      setEditStatus(e?.message || 'Save failed');
    }
    setEditBusy(false);
  };

  // Fetch user's bots from server (clear on wallet switch)
  useEffect(() => {
    setBots([]); // Clear immediately when address changes
    if (!address) return;
    const fetchBots = async () => {
      try {
        const res = await fetch('/api/user/onchain-bots?wallet=' + address);
        if (res.ok) {
          const data = await res.json();
          setBots(data.bots || []);
        }
      } catch (e) { console.error(e); }
    };
    fetchBots();
    const t = setInterval(fetchBots, 20000);
    return () => clearInterval(t);
  }, [address]);

  // Register: claim bot via regCode, then register on-chain
  const handleRegister = async () => {
    if (!isConnected) return alert('Connect Wallet');
    if (!newName) return alert('Enter Registration Code');

    try {
      setRegStatus('Claiming bot via registration code...');
      const res = await fetch('/api/bot/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ regCode: newName, owner: address })
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setRegStatus('⚠️ ' + (data.message || data.error || 'Failed'));
        return;
      }

      if (!data.onChainReady) {
        setRegStatus('⚠️ On-chain creation failed. Bot created locally but cannot register on-chain yet.');
        return;
      }

      // Wait for on-chain state to propagate to all RPC nodes (MetaMask uses Infura)
      setRegStatus('Waiting for on-chain confirmation...');
      await new Promise(r => setTimeout(r, 5000));

      // Ensure wallet is on Base Sepolia (critical for OKX and other wallets)
      if (chain?.id !== baseSepolia.id) {
        setRegStatus('Switching to Base Sepolia...');
        try {
          await switchChainAsync({ chainId: baseSepolia.id });
        } catch (switchErr: any) {
          setRegStatus('⚠️ Please manually switch your wallet to Base Sepolia (chain 84532)');
          return;
        }
      }

      setRegStatus(`Estimating gas...`);
      const botId32 = nameToBytes32(data.id);
      const regArgs = [botId32, '0x0000000000000000000000000000000000000000' as `0x${string}`] as const;
      const regValue = parseEther('0.01');
      const gas = await estimateGas({
        address: CONTRACTS.botRegistry as `0x${string}`,
        abi: BOT_REGISTRY_ABI,
        functionName: 'registerBot',
        args: [...regArgs],
        value: regValue,
        account: address as `0x${string}`,
      });
      setRegStatus(`Sign on-chain registration (0.01 ETH)...`);
      console.log('[Register] writeContractAsync params:', { botId: data.id, botId32, address: CONTRACTS.botRegistry, wallet: address, gas: gas?.toString() });
      setRegPending(true);
      setRegError(null);
      try {
        const hash = await writeContractAsync({
          address: CONTRACTS.botRegistry as `0x${string}`,
          abi: BOT_REGISTRY_ABI,
          functionName: 'registerBot',
          args: [...regArgs],
          value: regValue,
          chainId: baseSepolia.id,
          ...(gas ? { gas } : {}),
        });
        setRegHash(hash as `0x${string}`);
      } catch (e: any) {
        setRegError(e);
        console.error('[Register] writeContractAsync error:', e);
        // Extract revert reason for better error message
        const reason = e?.cause?.reason || e?.shortMessage || e?.message || '';
        const details = e?.cause?.shortMessage || e?.details || '';
        if (reason.includes('Max') && reason.includes('bots per user')) {
          setRegStatus('⚠️ This wallet has reached the max bots limit (5) on-chain. Use a different wallet.');
        } else if (reason.includes('already registered')) {
          setRegStatus('⚠️ This bot is already registered on-chain.');
        } else if (reason.includes('user rejected') || reason.includes('denied')) {
          setRegStatus('Transaction cancelled.');
        } else if (reason.includes('chain') || reason.includes('network') || reason.includes('switch')) {
          setRegStatus('⚠️ Please switch your wallet to Base Sepolia network (chainId: 84532)');
        } else {
          setRegStatus('⚠️ Registration failed: ' + (e?.shortMessage || e?.message || 'Unknown error') + (details ? ' | ' + details : ''));
        }
      }
      setRegPending(false);
    } catch (e: any) {
      setRegStatus('Error: ' + e.message);
    }
  };

  // Sell: approve NFT → list on marketplace
  const handleSell = async () => {
    if (!isConnected || !address) { setSellStatus('Please connect wallet first'); return; }
    if (!sellBot || !sellPrice) return;
    const priceNum = parseFloat(sellPrice);
    if (isNaN(priceNum) || priceNum <= 0) return alert('Enter a valid price');
    if (chain?.id !== baseSepolia.id) {
      try { await switchChainAsync({ chainId: baseSepolia.id }); } catch { setSellStatus('Please switch to Base Sepolia'); return; }
    }
    setSellBusy(true);
    setSellStatus('Looking up NFT tokenId...');
    try {
      const botIdHex = nameToBytes32(sellBot.botId);
      // Get tokenId from NFT contract
      const tokenId = await publicClient.readContract({
        address: CONTRACTS.snakeBotNFT as `0x${string}`,
        abi: SNAKE_BOT_NFT_ABI,
        functionName: 'botToTokenId',
        args: [botIdHex],
      });
      if (!tokenId || tokenId === 0n) {
        setSellStatus('This bot has no NFT. Register it first.');
        setSellBusy(false);
        return;
      }

      // Verify caller owns the NFT
      setSellStatus('Verifying NFT ownership...');
      const nftOwner = await publicClient.readContract({
        address: CONTRACTS.snakeBotNFT as `0x${string}`,
        abi: SNAKE_BOT_NFT_ABI,
        functionName: 'ownerOf',
        args: [tokenId],
      }) as string;
      if (nftOwner.toLowerCase() !== address.toLowerCase()) {
        setSellStatus(`You don't own this NFT (owner: ${nftOwner.slice(0,6)}...${nftOwner.slice(-4)})`);
        setSellBusy(false);
        return;
      }

      // Step 1: Check if already approved, skip if so
      const currentApproval = await publicClient.readContract({
        address: CONTRACTS.snakeBotNFT as `0x${string}`,
        abi: SNAKE_BOT_NFT_ABI,
        functionName: 'getApproved',
        args: [tokenId],
      }) as string;
      if (currentApproval.toLowerCase() !== (CONTRACTS.botMarketplace as string).toLowerCase()) {
        setSellStatus('1/2 Approving marketplace...');
        const approveGas = await estimateGas({
          address: CONTRACTS.snakeBotNFT as `0x${string}`,
          abi: SNAKE_BOT_NFT_ABI,
          functionName: 'approve',
          args: [CONTRACTS.botMarketplace as `0x${string}`, tokenId],
          account: address as `0x${string}`,
        });
        const approveTx = await writeContractAsync({
          address: CONTRACTS.snakeBotNFT as `0x${string}`,
          abi: SNAKE_BOT_NFT_ABI,
          functionName: 'approve',
          args: [CONTRACTS.botMarketplace as `0x${string}`, tokenId],
          chainId: baseSepolia.id,
          ...(approveGas ? { gas: approveGas } : {}),
        });
        await publicClient.waitForTransactionReceipt({ hash: approveTx as `0x${string}` });
        // Wait for on-chain state to propagate and wallet nonce to update
        setSellStatus('Waiting for approval to confirm...');
        for (let i = 0; i < 30; i++) {
          await new Promise(r => setTimeout(r, 2000));
          const newApproval = await publicClient.readContract({
            address: CONTRACTS.snakeBotNFT as `0x${string}`,
            abi: SNAKE_BOT_NFT_ABI,
            functionName: 'getApproved',
            args: [tokenId],
          }) as string;
          if (newApproval.toLowerCase() === (CONTRACTS.botMarketplace as string).toLowerCase()) break;
        }
      }

      // Step 2: List on marketplace
      setSellStatus('2/2 Listing on marketplace...');
      await new Promise(r => setTimeout(r, 2000));
      const priceWei = parseEther(sellPrice);
      let listTx: string | undefined;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const listGas = await estimateGas({
            address: CONTRACTS.botMarketplace as `0x${string}`,
            abi: BOT_MARKETPLACE_ABI,
            functionName: 'list',
            args: [tokenId, priceWei],
            account: address as `0x${string}`,
          });
          listTx = await writeContractAsync({
            address: CONTRACTS.botMarketplace as `0x${string}`,
            abi: BOT_MARKETPLACE_ABI,
            functionName: 'list',
            args: [tokenId, priceWei],
            chainId: baseSepolia.id,
            ...(listGas ? { gas: listGas } : {}),
          }) as unknown as string;
          break;
        } catch (listErr: any) {
          const errMsg = (listErr?.shortMessage || listErr?.message || '').toLowerCase();
          if (attempt < 2 && (errMsg.includes('nonce') || errMsg.includes('underpriced') || errMsg.includes('already known') || errMsg.includes('reverted'))) {
            setSellStatus(`Retrying... (${attempt + 1}/3)`);
            await new Promise(r => setTimeout(r, 4000));
            continue;
          }
          throw listErr;
        }
      }
      if (!listTx) throw new Error('List transaction failed after retries');
      await publicClient.waitForTransactionReceipt({ hash: listTx as `0x${string}` });

      setSellStatus('Listed! Your bot is now on the marketplace.');
      if (miscTimerRef.current) clearTimeout(miscTimerRef.current); miscTimerRef.current = setTimeout(() => { setSellBot(null); setSellPrice(''); setSellStatus(''); }, 2000);
    } catch (e: any) {
      let reason = '';
      let cur = e;
      while (cur) {
        if (cur.reason) { reason = cur.reason; break; }
        if (cur.data?.args?.[0]) { reason = String(cur.data.args[0]); break; }
        cur = cur.cause;
      }
      const msg = reason || e?.shortMessage || e?.message || 'Transaction failed';
      if (msg.includes('user rejected') || msg.includes('denied')) {
        setSellStatus('Cancelled');
      } else if (msg.includes('Not NFT owner')) {
        setSellStatus('You do not own this NFT');
      } else if (msg.includes('Not approved')) {
        setSellStatus('NFT approval failed — please try again');
      } else {
        setSellStatus(msg);
      }
    }
    setSellBusy(false);
  };

  useEffect(() => {
    if (regConfirming) setRegStatus('Confirming on-chain...');
    if (regConfirmed && regHash) {
      setRegStatus('Registered on-chain! NFT minted.');
      setNewName('');
    }
    if (regError) setRegStatus('⚠️ ' + regError.message);
  }, [regConfirming, regConfirmed, regHash, regError]);

  return (
    <div className="panel-card" style={{ maxHeight: '400px', overflowY: 'auto' }}>
      <div style={{ marginBottom: '6px', color: '#fff', fontSize: '0.85rem' }}>
        Bot Guide (click to copy URL):
      </div>
      <div
        className="copy-box"
        onClick={handleCopy}
        role="button"
        tabIndex={0}
        onKeyDown={e => e.key === 'Enter' && handleCopy()}
        style={{
          cursor: 'pointer', padding: '10px 12px', background: '#0d0d20',
          border: '1px solid var(--neon-blue)', borderRadius: '6px',
          fontFamily: 'monospace', fontSize: '0.75rem', color: 'var(--neon-green)',
          position: 'relative', userSelect: 'all',
          wordBreak: 'break-all' as const, lineHeight: '1.4',
        }}
      >
        📋 {guideUrl}
        {copied && (
          <span style={{
            position: 'absolute', right: 8, top: '-28px',
            background: 'var(--neon-green)', color: '#000', padding: '3px 10px', borderRadius: '4px',
            fontSize: '0.75rem', fontWeight: 'bold', pointerEvents: 'none',
            boxShadow: '0 2px 8px rgba(0,255,136,0.4)', zIndex: 10,
          }}>Copied!</span>
        )}
      </div>

      {/* Bot List */}
      <div style={{ marginTop: '10px' }}>
        {bots.length === 0 && (
          <div style={{
            padding: '6px 8px', marginBottom: '4px', borderRadius: '6px',
            background: 'rgba(255,255,255,0.03)', border: '1px dashed #2a2a3a',
            color: '#555', fontSize: '0.8rem', textAlign: 'center',
          }}>
            No bots yet — register one below
          </div>
        )}
        {bots.filter(b => b.registered).map((bot, i) => (
          <div key={bot.botId || i} style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '6px 8px', marginBottom: '4px', borderRadius: '6px',
            background: bot.listed ? 'rgba(255,165,0,0.08)' : 'rgba(0,255,136,0.08)',
            border: bot.listed ? '1px solid rgba(255,165,0,0.3)' : '1px solid rgba(0,255,136,0.3)',
          }}>
            <span style={{ color: bot.listed ? '#ffa500' : 'var(--neon-green)', fontWeight: 'bold', fontSize: '0.85rem', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {bot.listed ? '🏷️' : '🤖'} {bot.name}
              {bot.listed && <span style={{ fontSize: '0.6rem', color: '#ffa500', marginLeft: '4px' }}>(Listed {bot.salePrice} ETH)</span>}
            </span>
            <div style={{ display: 'flex', gap: '4px', marginLeft: '6px', flexShrink: 0 }}>
              <button type="button" onClick={() => handleEditOpen(bot)}
                style={{ padding: '2px 6px', fontSize: '0.65rem', background: '#1a1a2e', color: '#aaa', border: '1px solid #333', borderRadius: '4px', cursor: 'pointer' }}>
                Edit
              </button>
              {!bot.listed && (
                <button type="button" onClick={() => { setSellBot(bot); setSellPrice(''); setSellStatus(''); }}
                  style={{ padding: '2px 6px', fontSize: '0.65rem', background: '#1a1a2e', color: 'var(--neon-pink)', border: '1px solid rgba(255,0,128,0.3)', borderRadius: '4px', cursor: 'pointer' }}>
                  Sell
                </button>
              )}
            </div>
          </div>
        ))}
        {bots.filter(b => !b.registered).length > 0 && (
          <div style={{ color: 'var(--text-dim)', fontSize: '0.75rem', marginTop: '4px' }}>
            {bots.filter(b => !b.registered).length} bot(s) pending on-chain registration...
          </div>
        )}
      </div>

      {/* Edit Modal */}
      {editBot && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.8)', zIndex: 1000,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
          onClick={(e) => { if (e.target === e.currentTarget && !editBusy) { setEditBot(null); setEditCode(''); setEditToken(''); setEditStatus(''); } }}
        >
          <div style={{
            background: '#0d0d20', border: '1px solid var(--neon-green)', borderRadius: '10px',
            padding: '16px', width: '90%', maxWidth: '600px', maxHeight: '80vh',
            display: 'flex', flexDirection: 'column',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
              <h3 style={{ margin: 0, color: 'var(--neon-green)', fontSize: '1rem' }}>
                Edit: {editBot.name}
              </h3>
              <button
                onClick={() => { if (!editBusy) { setEditBot(null); setEditCode(''); setEditToken(''); setEditStatus(''); } }}
                style={{ width: 'auto', minWidth: 0, margin: 0, background: '#333', color: '#aaa', border: 'none', borderRadius: '4px', padding: '4px 8px', cursor: 'pointer', fontSize: '0.8rem' }}
              >X</button>
            </div>
            {editStatus && (
              <div style={{ padding: '6px 8px', marginBottom: '8px', borderRadius: '4px', background: 'rgba(255,255,255,0.05)', color: '#ccc', fontSize: '0.8rem' }}>
                {editStatus}
              </div>
            )}
            {editToken && (
              <>
                <textarea
                  value={editCode}
                  onChange={e => setEditCode(e.target.value)}
                  spellCheck={false}
                  style={{
                    flex: 1, minHeight: '300px', fontFamily: 'monospace', fontSize: '0.8rem',
                    background: '#000', color: '#0f0', border: '1px solid #333', borderRadius: '6px',
                    padding: '10px', resize: 'vertical', lineHeight: '1.5',
                  }}
                />
                <div style={{ display: 'flex', gap: '8px', marginTop: '10px', justifyContent: 'flex-end' }}>
                  <button
                    onClick={handleEditSave}
                    disabled={editBusy}
                    style={{ width: 'auto', minWidth: 0, margin: 0, padding: '6px 16px', fontSize: '0.8rem', background: 'var(--neon-green)', color: '#000', fontWeight: 'bold' }}
                  >
                    {editBusy ? 'Saving...' : 'Save'}
                  </button>
                  <button
                    onClick={() => { setEditBot(null); setEditCode(''); setEditToken(''); setEditStatus(''); }}
                    disabled={editBusy}
                    style={{ width: 'auto', minWidth: 0, margin: 0, padding: '6px 16px', fontSize: '0.8rem', background: '#333', color: '#aaa' }}
                  >
                    Cancel
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Sell Modal */}
      {sellBot && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.8)', zIndex: 1000,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
          onClick={(e) => { if (e.target === e.currentTarget && !sellBusy) { setSellBot(null); setSellPrice(''); setSellStatus(''); } }}
        >
          <div style={{
            background: '#0d0d20', border: '1px solid var(--neon-pink)', borderRadius: '10px',
            padding: '16px', width: '90%', maxWidth: '360px',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
              <div style={{ fontSize: '0.9rem', color: 'var(--neon-pink)', fontWeight: 'bold' }}>
                Sell: {sellBot.name || sellBot.botName || sellBot.botId}
              </div>
              <button onClick={() => { if (!sellBusy) { setSellBot(null); setSellPrice(''); setSellStatus(''); } }}
                style={{ width: 'auto', minWidth: 0, margin: 0, background: '#333', color: '#aaa', border: 'none', borderRadius: '4px', padding: '4px 8px', cursor: 'pointer', fontSize: '0.8rem' }}>
                X
              </button>
            </div>
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              <input
                placeholder="Price"
                value={sellPrice}
                onChange={e => setSellPrice(e.target.value)}
                type="number" min="0.001" step="0.001"
                style={{ flex: 1, fontSize: '0.85rem', width: 'auto' }}
              />
              <span style={{ color: '#aaa', fontSize: '0.85rem', whiteSpace: 'nowrap' }}>ETH</span>
              <button onClick={handleSell} disabled={sellBusy}
                style={{ width: 'auto', minWidth: 0, margin: 0, padding: '6px 14px', fontSize: '0.8rem', background: 'var(--neon-pink)', color: '#fff', whiteSpace: 'nowrap', fontWeight: 'bold' }}>
                {sellBusy ? '...' : 'List'}
              </button>
            </div>
            {sellStatus && <div className="muted" style={{ marginTop: '8px', fontSize: '0.8rem' }}>{sellStatus}</div>}
          </div>
        </div>
      )}

      {(
        <div style={{ display: 'flex', gap: '6px', marginTop: '8px', alignItems: 'center' }}>
          <input placeholder="Registration Code" value={newName} onChange={e => setNewName(e.target.value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 8))} maxLength={8} style={{ flex: 1 }} />
          <button
            onClick={handleRegister}
            disabled={regPending || regConfirming}
            style={{
              width: 'auto', padding: '8px 12px', margin: 0,
              background: 'var(--neon-pink)', fontSize: '0.75rem', whiteSpace: 'nowrap'
            }}
          >
            {regPending ? '...' : regConfirming ? '⏳' : '💎 Register 0.01E'}
          </button>
        </div>
      )}
      {regStatus && <div className="muted" style={{ marginTop: '4px' }}>{regStatus}</div>}
    </div>
  );
}

// Prediction — on-chain USDC betting via SnakeAgentsPariMutuel contract
function Prediction({ displayMatchId, nextMatch, epoch, arenaType, bettingOpen, arenaId }: { displayMatchId: string | null; nextMatch?: { matchId: number; displayMatchId: string; chainCreated?: boolean } | null; epoch: number; arenaType: 'performance' | 'competitive'; bettingOpen: boolean; arenaId: string }) {
  const { isConnected, address, chain } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const { signMessageAsync } = useSignMessage();
  const { switchChainAsync } = useSwitchChain();
  const [botName, setBotName] = useState('');
  const [targetMatch, setTargetMatch] = useState('');
  const [amount, setAmount] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [activeMatches, setActiveMatches] = useState<any[]>([]);

  useEffect(() => {
    if (displayMatchId) setTargetMatch(displayMatchId);
  }, [displayMatchId]);

  // Fetch all bettable matches across all rooms
  useEffect(() => {
    const fetchMatches = () => {
      fetch('/api/matches/active').then(r => r.json()).then(setActiveMatches).catch(() => {});
    };
    fetchMatches();
    const timer = setInterval(fetchMatches, 10000);
    return () => clearInterval(timer);
  }, []);

  const handlePredict = async () => {
    if (chain?.id !== baseSepolia.id) {
      try { await switchChainAsync({ chainId: baseSepolia.id }); } catch { return alert('Please switch to Base Sepolia'); }
    }
    const input = targetMatch.trim().toUpperCase();
    if (!/^[A-FP]\d+$/.test(input)) return alert('请输入比赛编号，如 A5 或 P3');
    let mid: number;
    try {
      const r = await fetch('/api/match/by-display-id?id=' + encodeURIComponent(input));
      if (!r.ok) return alert('无法找到比赛 ' + input);
      const d = await r.json();
      mid = d.matchId;
    } catch { return alert('查询比赛编号失败'); }
    if (isNaN(mid)) return alert('无法解析比赛编号');
    if (!botName) return alert('请输入机器人名称');
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) return alert('请输入 USDC 预测金额');
    if (!isConnected || !address) return alert('请先连接钱包');

    const botIdBytes32 = nameToBytes32(botName);
    const usdcAmount = parseUnits(amount, 6); // USDC has 6 decimals

    setBusy(true);
    try {
      // Step 0: Check USDC balance
      setStatus('检查 USDC 余额...');
      const usdcBalance = await publicClient.readContract({
        address: CONTRACTS.usdc as `0x${string}`,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [address],
      }) as bigint;

      if (usdcBalance < usdcAmount) {
        const balStr = (Number(usdcBalance) / 1e6).toFixed(2);
        setStatus(`❌ USDC 余额不足：当前 ${balStr} USDC，需要 ${amount} USDC。请先在 Base Sepolia 获取测试 USDC`);
        setBusy(false);
        return;
      }

      // Step 1: Check match exists on-chain (retry up to 30s for next-match that may still be creating)
      setStatus('验证链上比赛...');
      let matchReady = false;
      for (let attempt = 0; attempt < 6; attempt++) {
        try {
          const matchData = await publicClient.readContract({
            address: CONTRACTS.pariMutuel as `0x${string}`,
            abi: PARI_MUTUEL_ABI,
            functionName: 'matches',
            args: [BigInt(mid)],
          }) as any;
          if (matchData && matchData[0] !== 0n) {
            if (matchData[4]) { // settled
              setStatus('❌ 该比赛已结算');
              setBusy(false);
              return;
            }
            matchReady = true;
            break;
          }
        } catch { /* RPC error, retry */ }
        if (attempt < 5) {
          setStatus(`⏳ 等待链上比赛创建... (${attempt + 1}/6)`);
          await new Promise(r => setTimeout(r, 5000));
        }
      }
      if (!matchReady) {
        setStatus('⏳ 该比赛尚未在链上创建，请稍等后重试');
        setBusy(false);
        return;
      }

      // Step 2: Check USDC allowance, approve max if needed
      setStatus('检查 USDC 授权...');
      const currentAllowance = await publicClient.readContract({
        address: CONTRACTS.usdc as `0x${string}`,
        abi: ERC20_ABI,
        functionName: 'allowance',
        args: [address, CONTRACTS.pariMutuel as `0x${string}`],
      }) as bigint;

      if (currentAllowance < usdcAmount) {
        setStatus('授权 USDC...');
        const usdcApproveGas = await estimateGas({
          address: CONTRACTS.usdc as `0x${string}`,
          abi: ERC20_ABI,
          functionName: 'approve',
          args: [CONTRACTS.pariMutuel as `0x${string}`, usdcAmount],
          account: address as `0x${string}`,
        });
        const approveTx = await writeContractAsync({
          address: CONTRACTS.usdc as `0x${string}`,
          abi: ERC20_ABI,
          functionName: 'approve',
          args: [CONTRACTS.pariMutuel as `0x${string}`, usdcAmount],
          chainId: baseSepolia.id,
          ...(usdcApproveGas ? { gas: usdcApproveGas } : {}),
        });
        await publicClient.waitForTransactionReceipt({ hash: approveTx as `0x${string}` });
      }

      // Step 3: Place bet on-chain (USDC, no ETH value)
      setStatus('签名预测交易...');
      const betGas = await estimateGas({
        address: CONTRACTS.pariMutuel as `0x${string}`,
        abi: PARI_MUTUEL_ABI,
        functionName: 'placeBet',
        args: [BigInt(mid), botIdBytes32, usdcAmount],
        account: address as `0x${string}`,
      });
      const betTx = await writeContractAsync({
        address: CONTRACTS.pariMutuel as `0x${string}`,
        abi: PARI_MUTUEL_ABI,
        functionName: 'placeBet',
        args: [BigInt(mid), botIdBytes32, usdcAmount],
        chainId: baseSepolia.id,
        ...(betGas ? { gas: betGas } : {}),
      });

      setStatus('链上确认中...');
      await publicClient.waitForTransactionReceipt({ hash: betTx as `0x${string}` });

      // Award score for betting (best-effort, no extra signature needed)
      try {
        await fetch('/api/score/bet', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ address, amount: parseFloat(amount), matchId: mid, botId: botName, txHash: betTx }),
        });
      } catch (_) { /* score award is best-effort */ }

      setStatus(`✅ 完成下单！${amount} USDC 预测 ${botName} 赢`);
      setAmount('');
    } catch (e: any) {
      // Extract revert reason from error chain
      let reason = '';
      let cur = e;
      while (cur) {
        if (cur.reason) { reason = cur.reason; break; }
        if (cur.data?.args?.[0]) { reason = String(cur.data.args[0]); break; }
        cur = cur.cause;
      }
      const msg = reason || e?.shortMessage || e?.message || '交易失败';
      if (msg.includes('user rejected') || msg.includes('denied')) {
        setStatus('已取消');
      } else if (msg.includes('Match does not exist')) {
        setStatus('❌ 该比赛尚未在链上创建 — 请等待比赛开始后再下注');
      } else if (msg.includes('Betting closed')) {
        setStatus('❌ 下注窗口已关闭（比赛开始后5分钟内可下注）');
      } else if (msg.includes('settled') || msg.includes('already settled')) {
        setStatus('❌ 该比赛已结算');
      } else if (msg.includes('USDC transfer failed')) {
        setStatus('❌ USDC 转账失败 — 请确认余额充足且已授权');
      } else if (msg.includes('Bet amount')) {
        setStatus('❌ 下注金额必须大于 0');
      } else {
        setStatus('❌ ' + msg);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel-card">
      <div className="panel-row"><span>选择比赛</span><span>Epoch {epoch}</span></div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px', marginBottom: '6px' }}>
        {activeMatches.filter(m => m.arenaId === arenaId && (m.gameState === 'PLAYING' || m.gameState === 'COUNTDOWN' || m.gameState === 'GAMEOVER' || m.gameState === 'NEXT' || m.gameState === 'FUTURE')).map(m => {
          const isCurrent = m.displayMatchId === displayMatchId;
          const selected = targetMatch === m.displayMatchId;
          const isFuture = m.gameState === 'NEXT' || m.gameState === 'FUTURE';
          const canBetThis = m.bettingOpen || (isFuture && m.chainCreated);
          return (
            <button key={m.displayMatchId} onClick={() => setTargetMatch(m.displayMatchId)} type="button"
              style={{ fontSize: '0.82rem', padding: '6px 8px', borderRadius: '6px', background: selected ? 'var(--neon-green)' : 'transparent', color: selected ? '#000' : isCurrent ? 'var(--neon-green)' : isFuture ? '#66aaff' : '#aaa', border: `1px solid ${isCurrent ? 'var(--neon-green)' : isFuture ? '#3366aa' : canBetThis ? '#555' : '#333'}`, opacity: canBetThis ? 1 : 0.5, fontFamily: 'Orbitron, monospace', fontWeight: 'bold' }}>
              {m.displayMatchId}{isCurrent ? ' ★' : ''}{isFuture ? ' ⏳' : ''}{!canBetThis ? ' 🔒' : ''}
            </button>
          );
        })}
      </div>
      <input placeholder="比赛编号 (如 A5, P3)" value={targetMatch} onChange={e => setTargetMatch(e.target.value)} />
      <input placeholder="机器人名称 (预测谁赢?)" value={botName} onChange={e => setBotName(e.target.value)} style={{ marginTop: '6px' }} />
      <input placeholder="USDC 金额" value={amount} onChange={e => setAmount(e.target.value)} type="number" min="1" step="1" style={{ marginTop: '6px' }} />
      <div style={{ display: 'flex', gap: '4px', marginTop: '6px' }}>
        {['1', '5', '10'].map(v => (
          <button key={v} onClick={() => setAmount(v)} type="button"
            style={{ flex: 1, padding: '4px', fontSize: '0.75rem', background: amount === v ? 'var(--neon-green)' : '#1a1a2e', color: amount === v ? '#000' : '#aaa' }}>
            {v} USDC
          </button>
        ))}
      </div>
      {(() => {
        const selectedMatch = activeMatches.find(m => m.displayMatchId === targetMatch);
        const isFutureMatch = selectedMatch && (selectedMatch.gameState === 'NEXT' || selectedMatch.gameState === 'FUTURE');
        const canBet = bettingOpen || (isFutureMatch && selectedMatch.chainCreated);
        return <>
          <button onClick={handlePredict} disabled={busy || !canBet} style={{ marginTop: '6px' }}>
            {busy ? '⏳ ' + status : !canBet ? '🔒 投注已关闭' : isFutureMatch ? '⏳ 预测未来比赛' : '💰 USDC 预测'}
          </button>
          {!canBet && !busy && <div className="muted" style={{ marginTop: '6px', color: '#ff8800' }}>比赛开始 10 秒后投注关闭，可选择未来比赛提前下注以获得50%额外积分</div>}
        </>;
      })()}
      {!busy && status && <div className="muted" style={{ marginTop: '6px' }}>{status}</div>}
    </div>
  );
}

function CompetitiveEnter({ displayMatchId }: { displayMatchId: string | null }) {
  const { isConnected, address, chain } = useAccount();
  const [botName, setBotName] = useState('');
  const [targetMatch, setTargetMatch] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const { sendTransactionAsync } = useSendTransaction();
  const { switchChainAsync } = useSwitchChain();

  const handleEnter = async () => {
    if (!isConnected || !address) return alert('Connect Wallet');
    if (!botName) return alert('Enter Bot Name');
    if (!targetMatch) return alert('Enter target match (e.g. A3)');
    if (chain?.id !== baseSepolia.id) {
      try { await switchChainAsync({ chainId: baseSepolia.id }); } catch { return alert('Please switch to Base Sepolia'); }
    }

    setBusy(true);
    try {
      setStatus('Looking up bot...');
      const res = await fetch('/api/bot/lookup?name=' + encodeURIComponent(botName));
      if (!res.ok) {
        const err = await res.json();
        setStatus('⚠️ ' + (err.error === 'bot_not_found' ? 'Bot "' + botName + '" not found' : err.error));
        setBusy(false);
        return;
      }
      const data = await res.json();
      const resolvedBotId = data.botId;

      // Pay entry fee (0.001 ETH) via ETH transfer to backend wallet
      setStatus('Sign transaction (0.001 ETH)...');
      const txHash = await sendTransactionAsync({
        to: '0xe4b92D0B4D9Ae8EA89934D1C2E39aCbb86824DAF' as `0x${string}`,
        value: parseEther('0.001'),
        chainId: baseSepolia.id,
        gas: 21000n, // Simple ETH transfer is always 21000
      });

      setStatus('Confirming on-chain...');
      await publicClient.waitForTransactionReceipt({ hash: txHash });

      // Notify server of paid entry
      setStatus('Registering entry...');
      const enterRes = await fetch('/api/competitive/enter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ botId: resolvedBotId, displayMatchId: targetMatch, txHash })
      });
      const enterData = await enterRes.json();
      setStatus(enterData.ok ? '✅ Entry confirmed for match ' + targetMatch : '⚠️ ' + (enterData.error || enterData.message || 'Failed'));
    } catch (e: any) {
      const msg = e?.shortMessage || e?.message || 'Failed';
      if (msg.includes('user rejected') || msg.includes('denied')) {
        setStatus('Transaction cancelled.');
      } else {
        setStatus('⚠️ ' + msg);
      }
    }
    setBusy(false);
  };

  return (
    <div className="panel-card">
      <div className="panel-row"><span>Current Match</span><span>{displayMatchId || '--'}</span></div>
      <input placeholder="Bot Name" value={botName} onChange={e => setBotName(e.target.value)} />
      <input
        placeholder={`Target Match (e.g. A${displayMatchId ? parseInt(displayMatchId.replace(/\D/g, '')) + 1 : '?'})`}
        value={targetMatch}
        onChange={e => setTargetMatch(e.target.value)}
        style={{ marginTop: '6px' }}
      />
      <div className="muted" style={{ marginTop: '4px' }}>Cost: 0.001 ETH per entry</div>
      <button onClick={handleEnter} disabled={busy} style={{ marginTop: '6px' }}>
        {busy ? status || '...' : '🎯 Enter Arena'}
      </button>
      {!busy && status && <div className="muted" style={{ marginTop: '6px' }}>{status}</div>}
    </div>
  );
}

// Issue 4 & 5: GameCanvas with displayMatchId and epoch
function GameCanvas({
  mode,
  setMatchId,
  setPlayers,
  setDisplayMatchId,
  setNextMatch,
  setEpoch,
  setBettingOpen,
}: {
  mode: 'performance' | 'competitive';
  setMatchId: (id: number | null) => void;
  setPlayers: (players: any[]) => void;
  setDisplayMatchId: (id: string | null) => void;
  setNextMatch: (m: { matchId: number; displayMatchId: string } | null) => void;
  setEpoch: (n: number) => void;
  setBettingOpen: (open: boolean) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const foodImgRef = useRef<HTMLImageElement | null>(null);
  useEffect(() => {
    const img = new Image();
    img.src = foodSvgUrl;
    img.onload = () => { foodImgRef.current = img; };
  }, []);
  const [status, setStatus] = useState('Connecting...');
  const [overlay, setOverlay] = useState<React.ReactNode>(null);
  const [timer, setTimer] = useState('3:00');
  const [timerColor, setTimerColor] = useState('#ff8800');
  const [matchInfo, setMatchInfo] = useState('ARENA: --');
  const [selectedRoom, setSelectedRoom] = useState('A');
  const [roomCount, setRoomCount] = useState(1);

  const isCompetitive = mode === 'competitive';

  useEffect(() => {
    if (isCompetitive) return;
    const fetchRooms = async () => {
      try {
        const res = await fetch('/api/arena/status');
        const data = await res.json();
        setRoomCount(data.performance?.length || 1);
      } catch (e) { console.error(e); }
    };
    fetchRooms();
    const t = setInterval(fetchRooms, 5000);
    return () => clearInterval(t);
  }, [isCompetitive]);

  useEffect(() => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const arenaId = isCompetitive ? 'competitive-1' : `performance-${selectedRoom}`;
    const wsUrl = `${proto}://${window.location.host}/ws?arenaId=${arenaId}`;

    let ws: WebSocket;
    let reconnectDelay = 1000;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let destroyed = false;

    const connect = () => {
        if (destroyed) return;
        // Close any lingering previous connection before creating a new one
        if (ws && ws.readyState !== WebSocket.CLOSED) {
            ws.onclose = null; // prevent triggering reconnect from manual close
            ws.close();
        }
        ws = new WebSocket(wsUrl);
        ws.onopen = () => { setStatus('Connected!'); reconnectDelay = 1000; };
        ws.onclose = () => {
            if (destroyed) return;
            setStatus('Disconnected — reconnecting...');
            if (reconnectTimer) clearTimeout(reconnectTimer);
            reconnectTimer = setTimeout(() => {
                reconnectDelay = Math.min(reconnectDelay * 2, 16000);
                connect();
            }, reconnectDelay);
        };
        ws.onerror = () => {}; // onclose will fire after this
        ws.onmessage = (e) => {
            try {
                const msg = JSON.parse(e.data);
                if (msg.type === 'update' && msg.state && Array.isArray(msg.state.players) && Array.isArray(msg.state.food)) {
                    render(msg.state);
                }
            } catch (e) { console.error(e); }
        };
    };

    connect();

    const render = (state: any) => {
        setMatchId(state.matchId);
        setDisplayMatchId(state.displayMatchId || null);
        setNextMatch(state.nextMatch || null);
        if (state.epoch) setEpoch(state.epoch);
        setBettingOpen(!!state.bettingOpen);

        // Issue 5: Show "Epoch X #displayMatchId"
        const epochStr = state.epoch ? `Epoch ${state.epoch}` : '';
        const matchStr = state.displayMatchId || `#${state.matchId || '?'}`;
        setMatchInfo(`${isCompetitive ? '⚔️ ' : ''}${epochStr} ${matchStr}`);

        const alivePlayers = state.players || [];
        const waitingPlayers = (state.waitingPlayers || []).map((p: any) => ({ ...p, waiting: true }));
        setPlayers([...alivePlayers, ...waitingPlayers]);

        if (state.gameState === 'PLAYING') {
            const min = Math.floor(state.matchTimeLeft/60);
            const sec = state.matchTimeLeft%60;
            setTimer(`${min}:${sec.toString().padStart(2,'0')}`);
            setTimerColor(state.matchTimeLeft < 30 ? '#ff3333' : '#ff8800');
            setOverlay(null);
        } else if (state.gameState === 'COUNTDOWN') {
            setTimer(`Starting in ${state.timeLeft}s`);
            setTimerColor('#00ff88');
            setOverlay(<div className="overlay-text">GET READY!</div>);
        } else if (state.gameState === 'GAMEOVER') {
            setTimer(`Next in ${state.timeLeft}s`);
            setTimerColor('#888');
            setOverlay(<>
                <div className="overlay-text">🏆</div>
                <div className="overlay-text">{state.winner || 'NO WINNER'}</div>
            </>);
        } else if (state.victoryPause) {
            const winner = state.players.find((p: any) => p.alive);
            setOverlay(<>
                <div className="overlay-text">🏆</div>
                <div className="overlay-text">{winner ? winner.name : ''} WINS!</div>
            </>);
        }

        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        const dpr = window.devicePixelRatio || 1;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        const cellSize = (canvas.width / dpr) / 30;

        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.strokeStyle = isCompetitive ? '#1a1020' : '#1a1a2e';
        ctx.lineWidth = 0.5;
        for (let i = 0; i <= 30; i++) {
            ctx.beginPath(); ctx.moveTo(i*cellSize, 0); ctx.lineTo(i*cellSize, canvas.height); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(0, i*cellSize); ctx.lineTo(canvas.width, i*cellSize); ctx.stroke();
        }

        if (state.obstacles && state.obstacles.length > 0) {
            for (const obs of state.obstacles) {
                if (obs.solid) {
                    ctx.fillStyle = '#8b0000';
                    ctx.shadowColor = '#ff0000';
                    ctx.shadowBlur = 4;
                    ctx.fillRect(obs.x * cellSize, obs.y * cellSize, cellSize, cellSize);
                    ctx.shadowBlur = 0;
                    ctx.strokeStyle = '#ff4444';
                    ctx.lineWidth = 1;
                    ctx.beginPath();
                    ctx.moveTo(obs.x * cellSize + 2, obs.y * cellSize + 2);
                    ctx.lineTo((obs.x + 1) * cellSize - 2, (obs.y + 1) * cellSize - 2);
                    ctx.moveTo((obs.x + 1) * cellSize - 2, obs.y * cellSize + 2);
                    ctx.lineTo(obs.x * cellSize + 2, (obs.y + 1) * cellSize - 2);
                    ctx.stroke();
                } else {
                    const blink = Math.floor(Date.now() / 200) % 2 === 0;
                    if (blink) {
                        ctx.fillStyle = 'rgba(255, 200, 0, 0.6)';
                        ctx.shadowColor = '#ffcc00';
                        ctx.shadowBlur = 8;
                        ctx.fillRect(obs.x * cellSize, obs.y * cellSize, cellSize, cellSize);
                        ctx.shadowBlur = 0;
                    } else {
                        ctx.fillStyle = 'rgba(255, 200, 0, 0.2)';
                        ctx.fillRect(obs.x * cellSize, obs.y * cellSize, cellSize, cellSize);
                    }
                    ctx.strokeStyle = 'rgba(255, 200, 0, 0.8)';
                    ctx.lineWidth = 1;
                    ctx.strokeRect(obs.x * cellSize, obs.y * cellSize, cellSize, cellSize);
                }
            }
        }

        state.food.forEach((f: any) => {
            if (foodImgRef.current) {
                const pad = cellSize * 0.1;
                ctx.drawImage(foodImgRef.current, f.x * cellSize + pad, f.y * cellSize + pad, cellSize - pad * 2, cellSize - pad * 2);
            } else {
                ctx.fillStyle = '#ff0055';
                ctx.shadowColor = '#ff0055'; ctx.shadowBlur = 10;
                ctx.beginPath(); ctx.arc(f.x*cellSize+cellSize/2, f.y*cellSize+cellSize/2, cellSize/3, 0, Math.PI*2); ctx.fill();
                ctx.shadowBlur = 0;
            }
        });

        (state.players || []).forEach((p: any) => {
            if (!p.body || p.body.length === 0) return;

            const isBlinking = !p.alive && p.blinking;
            if (isBlinking && Math.floor(Date.now() / 500) % 2 === 0) return;

            ctx.fillStyle = p.color || '#00ff88';
            ctx.shadowColor = p.color || '#00ff88';
            ctx.shadowBlur = p.alive ? 8 : 0;
            ctx.globalAlpha = p.alive ? 1 : 0.4;

            const pName = p.name || '';
            p.body.forEach((seg: any, i: number) => {
                if (i === 0) return;
                ctx.fillRect(seg.x * cellSize + 1, seg.y * cellSize + 1, cellSize - 2, cellSize - 2);
                const letterIdx = i - 1;
                if (letterIdx < pName.length && pName[letterIdx]) {
                    ctx.save();
                    ctx.fillStyle = '#000';
                    ctx.shadowBlur = 0;
                    ctx.globalAlpha = p.alive ? 0.8 : 0.3;
                    ctx.font = `bold ${Math.max(cellSize * 0.6, 8)}px Orbitron, monospace`;
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(pName[letterIdx], seg.x * cellSize + cellSize/2, seg.y * cellSize + cellSize/2 + 1);
                    ctx.restore();
                    ctx.fillStyle = p.color || '#00ff88';
                    ctx.shadowColor = p.color || '#00ff88';
                    ctx.shadowBlur = p.alive ? 8 : 0;
                    ctx.globalAlpha = p.alive ? 1 : 0.4;
                }
            });

            const head = p.body[0];
            const dir = p.direction || {x:1, y:0};
            const cx = head.x * cellSize + cellSize/2;
            const cy = head.y * cellSize + cellSize/2;
            const size = cellSize/2 - 1;

            ctx.beginPath();
            if (dir.x === 1) { ctx.moveTo(cx+size,cy); ctx.lineTo(cx-size,cy-size); ctx.lineTo(cx-size,cy+size); }
            else if (dir.x === -1) { ctx.moveTo(cx-size,cy); ctx.lineTo(cx+size,cy-size); ctx.lineTo(cx+size,cy+size); }
            else if (dir.y === -1) { ctx.moveTo(cx,cy-size); ctx.lineTo(cx-size,cy+size); ctx.lineTo(cx+size,cy+size); }
            else { ctx.moveTo(cx,cy+size); ctx.lineTo(cx-size,cy-size); ctx.lineTo(cx+size,cy-size); }
            ctx.closePath();
            ctx.fill();

            // HP bar above snake head
            if (p.alive && p.hp != null) {
                const barW = cellSize * 1.2;
                const barH = Math.max(2, cellSize * 0.15);
                const barX = head.x * cellSize + cellSize / 2 - barW / 2;
                const barY = head.y * cellSize - barH - 2;
                const hpRatio = Math.max(0, Math.min(1, p.hp / 100));
                // Background (dark)
                ctx.save();
                ctx.shadowBlur = 0;
                ctx.globalAlpha = 0.6;
                ctx.fillStyle = '#333';
                ctx.fillRect(barX, barY, barW, barH);
                // HP fill (green → yellow → red)
                ctx.globalAlpha = 0.9;
                ctx.fillStyle = hpRatio > 0.5 ? `rgb(${Math.round((1 - hpRatio) * 2 * 255)},255,0)` : `rgb(255,${Math.round(hpRatio * 2 * 255)},0)`;
                ctx.fillRect(barX, barY, barW * hpRatio, barH);
                ctx.restore();
                ctx.fillStyle = p.color || '#00ff88';
            }

            ctx.shadowBlur = 0;
            ctx.globalAlpha = 1;
        });
    };

    return () => { destroyed = true; if (reconnectTimer) clearTimeout(reconnectTimer); if (ws) ws.close(); };
  }, [setMatchId, setPlayers, selectedRoom, isCompetitive, setDisplayMatchId, setNextMatch, setEpoch]);

  const borderColor = isCompetitive ? 'var(--neon-pink)' : 'var(--neon-blue)';

  return (
    <div className="main-stage">
        {isCompetitive ? (
          <h1 style={{ color: 'var(--neon-pink)', textShadow: '0 0 10px rgba(255,0,85,0.5)' }}>⚔️ COMPETITIVE ARENA</h1>
        ) : (
          <h1>🦀 SNAKE AGENTS {selectedRoom}
            <span className="room-selector">
              {['A','B','C','D','E','F'].map((letter, i) => (
                <button
                  key={letter}
                  className={`room-btn ${selectedRoom === letter ? 'active' : ''} ${i >= roomCount ? 'disabled' : ''}`}
                  onClick={() => i < roomCount && setSelectedRoom(letter)}
                  disabled={i >= roomCount}
                >{letter}</button>
              ))}
            </span>
          </h1>
        )}
        <div className="match-info">{matchInfo}</div>
        <div className="timer" style={{ color: timerColor }}>{timer}</div>
        <div className="canvas-wrap">
          <canvas ref={canvasRef} width={600 * (typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1)} height={600 * (typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1)} style={{ width: 'min(600px, 90vw, 70vh)', height: 'min(600px, 90vw, 70vh)', border: `4px solid ${borderColor}`, background: '#000' }}></canvas>
          <div id="overlay">{overlay}</div>
        </div>
        <div className="status-bar">{status}</div>
        <div className="rules-wrap">
          <h3>📜 {isCompetitive ? '竞技场规则' : '游戏规则'}</h3>
          <div className="rules-box">{isCompetitive ? COMPETITIVE_RULES : PERFORMANCE_RULES}</div>
        </div>
    </div>
  );
}

// Score type labels (Chinese)
const SCORE_TYPE_LABELS: Record<string, string> = {
  register: '注册奖励',
  checkin: '每日签到',
  match_participate: '参赛奖励',
  match_place: '名次奖励',
  bet_activity: '预测参与',
  bet_win: '预测赢利',
  referral_l1: '邀请奖励 L1',
  referral_l2: '邀请奖励 L2',
};

// Full-page Points view — shows Score
function PointsPage() {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [myScore, setMyScore] = useState<any>(null);
  const [leaderboard, setLeaderboard] = useState<any[]>([]);
  const [checkinStatus, setCheckinStatus] = useState('');
  const [checkinBusy, setCheckinBusy] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const [adRes, lbRes] = await Promise.all([
          address ? fetch('/api/score/my?address=' + address) : Promise.resolve(null),
          fetch('/api/score/leaderboard'),
        ]);
        if (adRes && adRes.ok) setMyScore(await adRes.json());
        if (lbRes.ok) setLeaderboard(await lbRes.json());
      } catch (e) { console.error(e); }
    };
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [address]);

  const handleCheckin = async () => {
    if (!address) return;
    setCheckinBusy(true);
    setCheckinStatus('Signing...');
    try {
      // Request wallet signature
      const timestamp = Date.now().toString();
      const message = `SnakeAgents Checkin\nAddress: ${address}\nTimestamp: ${timestamp}`;
      const signature = await signMessageAsync({ message });

      const res = await fetch('/api/score/checkin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address, signature, timestamp }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setCheckinStatus(`+${data.points} pts! ${data.message}`);
        // Refresh data
        const adRes = await fetch('/api/score/my?address=' + address);
        if (adRes.ok) setMyScore(await adRes.json());
      } else {
        setCheckinStatus(data.message || data.error || 'Failed');
      }
    } catch (e: any) {
      setCheckinStatus(e?.shortMessage || e?.message || 'Error');
    }
    setCheckinBusy(false);
  };

  return (
    <div style={{ padding: '24px', width: '100%', maxWidth: '800px', margin: '0 auto' }}>
      <h2 style={{ color: 'var(--neon-green)', textAlign: 'center', marginBottom: '20px' }}>积分</h2>

      {/* Score Card */}
      <div className="panel-section" style={{ marginBottom: '24px' }}>
        <h3>我的积分</h3>
        {!address ? (
          <div className="panel-card muted">Connect wallet to see your points</div>
        ) : !myScore ? (
          <div className="panel-card muted">Loading...</div>
        ) : (
          <div className="panel-card">
            <div style={{ display: 'flex', justifyContent: 'space-around', textAlign: 'center', marginBottom: '12px' }}>
              <div>
                <div style={{ fontSize: '2rem', fontWeight: 'bold', color: 'var(--neon-green)' }}>{myScore.total || 0}</div>
                <div className="muted">积分</div>
              </div>
              {myScore.rank && (
                <div>
                  <div style={{ fontSize: '2rem', fontWeight: 'bold', color: 'var(--neon-blue)' }}>#{myScore.rank}</div>
                  <div className="muted">Rank</div>
                </div>
              )}
              <div>
                <div style={{ fontSize: '2rem', fontWeight: 'bold', color: '#ff8800' }}>{myScore.checkin?.streak || 0}</div>
                <div className="muted">Streak</div>
              </div>
            </div>

            {/* Check-in Button */}
            <div style={{ textAlign: 'center', marginBottom: '12px' }}>
              <button
                onClick={handleCheckin}
                disabled={checkinBusy || !(myScore.checkin?.canCheckin)}
                style={{
                  padding: '10px 24px', fontSize: '1rem', fontWeight: 'bold',
                  background: myScore.checkin?.canCheckin ? 'var(--neon-green)' : '#333',
                  color: myScore.checkin?.canCheckin ? '#000' : '#666',
                  border: 'none', borderRadius: '8px', cursor: myScore.checkin?.canCheckin ? 'pointer' : 'default',
                }}
              >
                {checkinBusy ? 'Signing...' : myScore.checkin?.canCheckin ? 'Daily Check-in (+10 pts)' : 'Checked in today'}
              </button>
              {checkinStatus && <div className="muted" style={{ marginTop: '6px' }}>{checkinStatus}</div>}
            </div>

            {/* Points breakdown */}
            <div style={{ fontSize: '0.75rem', color: '#888', marginBottom: '8px', textAlign: 'center' }}>
              积分只会累积增加，不会减少。
            </div>

            {myScore.history && myScore.history.length > 0 && (
              <>
                <h4 style={{ color: '#aaa', fontSize: '0.85rem', marginBottom: '6px' }}>Recent Activity</h4>
                <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
                  {myScore.history.map((h: any, i: number) => (
                    <div key={h.ts || i} style={{
                      display: 'flex', justifyContent: 'space-between', padding: '4px 8px',
                      borderBottom: '1px solid #1b1b2b', fontSize: '0.8rem',
                    }}>
                      <span className="muted">{SCORE_TYPE_LABELS[h.type] || h.type}</span>
                      <span style={{ color: 'var(--neon-green)' }}>+{h.points}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Score Rules */}
      <div className="panel-section" style={{ marginBottom: '24px' }}>
        <h3>How to Earn Points</h3>
        <div className="panel-card" style={{ fontSize: '0.82rem', lineHeight: '1.7' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '2px 16px' }}>
            <span>Register a bot</span><span style={{ color: 'var(--neon-green)' }}>+200</span>
            <span>Daily check-in (day 1-6)</span><span style={{ color: 'var(--neon-green)' }}>+10</span>
            <span>7-day streak bonus</span><span style={{ color: 'var(--neon-green)' }}>+30</span>
            <span>Bot participates in match</span><span style={{ color: 'var(--neon-green)' }}>+5</span>
            <span>1st / 2nd / 3rd place</span><span style={{ color: 'var(--neon-green)' }}>+50 / +30 / +20</span>
            <span>下注预测</span><span style={{ color: 'var(--neon-green)' }}>+等额积分</span>
            <span>Invite L1 / L2</span><span style={{ color: 'var(--neon-green)' }}>+100 / +50</span>
          </div>
        </div>
      </div>

      {/* Score Leaderboard */}
      <div className="panel-section">
        <h3>积分排行榜 (Top 50)</h3>
        <ul className="fighter-list">
          {leaderboard.map((p: any, i: number) => (
            <li key={p.address || i} className="fighter-item alive">
              <span className="fighter-name">
                {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i+1}`}{' '}
                {p.address ? (p.address.slice(0, 6) + '...' + p.address.slice(-4)) : 'unknown'}
              </span>
              <span className="fighter-length" style={{ color: 'var(--neon-green)' }}>{p.total || 0} pts</span>
            </li>
          ))}
          {leaderboard.length === 0 && <li className="fighter-item"><span className="muted">No data yet</span></li>}
        </ul>
      </div>
    </div>
  );
}

// Runner Pool Display — shows total runner rewards accumulated (visible to all)
function RunnerPoolDisplay() {
  const [total, setTotal] = useState('0');
  useEffect(() => {
    const load = () => {
      fetch('/api/runner-rewards/stats')
        .then(r => r.json())
        .then(d => { if (d.totalAccumulated) setTotal(d.totalAccumulated); })
        .catch(() => {});
    };
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, []);
  return (
    <div style={{
      padding: '4px 10px', fontSize: '0.72rem', borderRadius: '6px',
      background: 'rgba(255,170,0,0.1)', border: '1px solid rgba(255,170,0,0.4)',
      color: '#ffaa00', fontFamily: 'Orbitron, monospace', fontWeight: 'bold',
      whiteSpace: 'nowrap',
    }}>
      Runner Pool: {parseFloat(total).toFixed(2)} USDC
    </div>
  );
}

// Portfolio button — shown in header next to wallet button
function PortfolioButton({ activePage, onSwitch }: { activePage: string; onSwitch: (p: any) => void }) {
  const { isConnected } = useAccount();
  if (!isConnected) return null;
  const isActive = activePage === 'portfolio';
  return (
    <button
      onClick={() => onSwitch('portfolio')}
      style={{
        padding: '6px 12px', fontSize: '0.8rem', borderRadius: '8px',
        background: isActive ? 'var(--neon-green)' : 'rgba(0,255,136,0.1)',
        color: isActive ? '#000' : 'var(--neon-green)',
        border: '1px solid var(--neon-green)', cursor: 'pointer',
        fontFamily: 'Orbitron, monospace', fontWeight: 'bold',
      }}
    >
      Portfolio
    </button>
  );
}

// Full-page Portfolio view — positions, history, claim
function PortfolioPage() {
  const { address, isConnected, chain } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const { switchChainAsync } = useSwitchChain();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'positions' | 'history' | 'mybots'>('positions');
  const [myBots, setMyBots] = useState<any[]>([]);
  const [botsLoading, setBotsLoading] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [claimStatus, setClaimStatus] = useState('');
  const [runnerRewards, setRunnerRewards] = useState<{ bots: any[]; total: string }>({ bots: [], total: '0' });
  const [claimingRunner, setClaimingRunner] = useState(false);
  const [runnerClaimStatus, setRunnerClaimStatus] = useState('');

  const loadRunnerRewards = async () => {
    if (!address) return;
    try {
      const res = await fetch(`/api/runner-rewards/pending?address=${address}`);
      if (res.ok) setRunnerRewards(await res.json());
    } catch (_e) { /* ignore */ }
  };

  const loadData = async () => {
    if (!address) { setLoading(false); return; }
    try {
      const res = await fetch(`/api/portfolio?address=${address}`);
      if (res.ok) setData(await res.json());
    } catch (_e) { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => {
    setLoading(true);
    loadData();
    loadRunnerRewards();
    const t = setInterval(() => { loadData(); loadRunnerRewards(); }, 15000);
    return () => clearInterval(t);
  }, [address]);

  useEffect(() => {
    if (tab !== 'mybots' || !address) return;
    setBotsLoading(true);
    const loadBots = async () => {
      try {
        const [nftRes, lbPerfRes, lbCompRes] = await Promise.all([
          fetch(`/api/user/onchain-bots?wallet=${address}`),
          fetch('/api/leaderboard/performance'),
          fetch('/api/leaderboard/competitive'),
        ]);
        const nftData = nftRes.ok ? await nftRes.json() : { bots: [] };
        const perfLb: any[] = lbPerfRes.ok ? await lbPerfRes.json() : [];
        const compLb: any[] = lbCompRes.ok ? await lbCompRes.json() : [];
        const winsMap: Record<string, number> = {};
        perfLb.forEach((e: any) => { winsMap[e.name] = (winsMap[e.name] || 0) + e.wins; });
        compLb.forEach((e: any) => { winsMap[e.name] = (winsMap[e.name] || 0) + e.wins; });
        const bots = (nftData.bots || []).map((b: any) => ({
          ...b,
          wins: winsMap[b.botName] || winsMap[b.name] || 0,
        }));
        setMyBots(bots);
      } catch (_) {}
      setBotsLoading(false);
    };
    loadBots();
  }, [tab, address]);

  const handleClaimAll = async () => {
    if (!data?.claimable?.length || claiming) return;
    if (chain?.id !== baseSepolia.id) {
      try { await switchChainAsync({ chainId: baseSepolia.id }); } catch { setClaimStatus('Please switch to Base Sepolia'); return; }
    }
    setClaiming(true);
    setClaimStatus('Claiming...');
    let claimed = 0;
    for (const item of data.claimable) {
      try {
        const claimGas2 = await estimateGas({
          address: CONTRACTS.pariMutuel as `0x${string}`,
          abi: PARI_MUTUEL_ABI,
          functionName: 'claimWinnings',
          args: [BigInt(item.matchId)],
          account: address as `0x${string}`,
        });
        await writeContractAsync({
          address: CONTRACTS.pariMutuel as `0x${string}`,
          abi: PARI_MUTUEL_ABI,
          functionName: 'claimWinnings',
          args: [BigInt(item.matchId)],
          chainId: baseSepolia.id,
          ...(claimGas2 ? { gas: claimGas2 } : {}),
        });
        claimed++;
        setClaimStatus(`Claimed ${claimed}/${data.claimable.length}...`);
      } catch (e: any) {
        const msg = e?.shortMessage || e?.message || '';
        if (msg.includes('rejected') || msg.includes('denied')) {
          setClaimStatus('Cancelled');
          setClaiming(false);
          return;
        }
        setClaimStatus(`Match #${item.matchId} failed, continuing...`);
      }
    }
    setClaiming(false);
    setClaimStatus(claimed > 0 ? `Claimed ${claimed} match(es)!` : 'No claims succeeded');
    loadData();
  };

  const handleClaimRunnerRewards = async () => {
    if (!runnerRewards.bots.length || claimingRunner) return;
    if (chain?.id !== baseSepolia.id) {
      try { await switchChainAsync({ chainId: baseSepolia.id }); } catch { setRunnerClaimStatus('Please switch to Base Sepolia'); return; }
    }
    setClaimingRunner(true);
    setRunnerClaimStatus('Claiming runner rewards...');
    try {
      const botIds = runnerRewards.bots.map((b: any) => b.botId);
      const gas = await estimateGas({
        address: CONTRACTS.pariMutuel as `0x${string}`,
        abi: PARI_MUTUEL_ABI,
        functionName: 'claimRunnerRewardsBatch',
        args: [botIds],
        account: address as `0x${string}`,
      });
      await writeContractAsync({
        address: CONTRACTS.pariMutuel as `0x${string}`,
        abi: PARI_MUTUEL_ABI,
        functionName: 'claimRunnerRewardsBatch',
        args: [botIds],
        chainId: baseSepolia.id,
        ...(gas ? { gas } : {}),
      });
      setRunnerClaimStatus('Runner rewards claimed!');
      loadRunnerRewards();
    } catch (e: any) {
      const msg = e?.shortMessage || e?.message || '';
      if (msg.includes('rejected') || msg.includes('denied')) {
        setRunnerClaimStatus('Cancelled');
      } else {
        setRunnerClaimStatus('Claim failed: ' + msg.slice(0, 80));
      }
    }
    setClaimingRunner(false);
  };

  if (!isConnected) {
    return (
      <div style={{ padding: '48px 24px', textAlign: 'center' }}>
        <h2 style={{ color: 'var(--neon-green)', marginBottom: '16px' }}>Portfolio</h2>
        <div className="panel-card muted" style={{ maxWidth: 400, margin: '0 auto', padding: 24 }}>
          Connect your wallet to view your portfolio
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '24px', width: '100%', maxWidth: '800px', margin: '0 auto' }}>
      <h2 style={{ color: 'var(--neon-green)', textAlign: 'center', marginBottom: '20px' }}>Portfolio</h2>

      {/* Claimable Winnings Banner — always visible */}
      <div className="panel-section" style={{ marginBottom: '24px' }}>
        {(() => {
          const hasClaimable = data && parseFloat(data.claimableTotal) > 0;
          return (
            <div className="panel-card" style={{
              background: hasClaimable ? 'rgba(0,255,136,0.08)' : 'rgba(255,255,255,0.03)',
              border: hasClaimable ? '1px solid var(--neon-green)' : '1px solid #2a2a4a',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '16px 20px', borderRadius: '10px',
            }}>
              <div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)', marginBottom: 4 }}>Claimable Winnings</div>
                <div style={{ fontSize: '1.6rem', fontWeight: 'bold', color: hasClaimable ? 'var(--neon-green)' : '#555' }}>
                  {data ? data.claimableTotal : '...'} USDC
                </div>
              </div>
              <button
                onClick={handleClaimAll}
                disabled={claiming || !hasClaimable}
                style={{
                  padding: '10px 24px', borderRadius: '8px',
                  background: !hasClaimable ? '#222' : claiming ? '#333' : 'var(--neon-green)',
                  color: !hasClaimable ? '#555' : claiming ? '#888' : '#000',
                  border: 'none',
                  cursor: !hasClaimable || claiming ? 'not-allowed' : 'pointer',
                  fontFamily: 'Orbitron, monospace', fontSize: '0.85rem', fontWeight: 'bold',
                }}
              >
                {claiming ? 'Claiming...' : 'Claim All'}
              </button>
            </div>
          );
        })()}
        {claimStatus && (
          <div style={{ fontSize: '0.75rem', color: 'var(--neon-blue)', marginTop: 6, textAlign: 'center' }}>{claimStatus}</div>
        )}
      </div>

      {/* Runner Rewards Banner */}
      <div className="panel-section" style={{ marginBottom: '24px' }}>
        {(() => {
          const hasRunner = parseFloat(runnerRewards.total) > 0;
          return (
            <div className="panel-card" style={{
              background: hasRunner ? 'rgba(255,170,0,0.08)' : 'rgba(255,255,255,0.03)',
              border: hasRunner ? '1px solid #ffaa00' : '1px solid #2a2a4a',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '16px 20px', borderRadius: '10px',
            }}>
              <div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)', marginBottom: 4 }}>Runner Rewards</div>
                <div style={{ fontSize: '1.6rem', fontWeight: 'bold', color: hasRunner ? '#ffaa00' : '#555' }}>
                  {runnerRewards.total} USDC
                </div>
                {hasRunner && (
                  <div style={{ fontSize: '0.7rem', color: '#888', marginTop: 2 }}>
                    {runnerRewards.bots.map((b: any) => `${b.botName}: ${b.pending}`).join(' | ')}
                  </div>
                )}
              </div>
              <button
                onClick={handleClaimRunnerRewards}
                disabled={claimingRunner || !hasRunner}
                style={{
                  padding: '10px 24px', borderRadius: '8px',
                  background: !hasRunner ? '#222' : claimingRunner ? '#333' : '#ffaa00',
                  color: !hasRunner ? '#555' : claimingRunner ? '#888' : '#000',
                  border: 'none',
                  cursor: !hasRunner || claimingRunner ? 'not-allowed' : 'pointer',
                  fontFamily: 'Orbitron, monospace', fontSize: '0.85rem', fontWeight: 'bold',
                }}
              >
                {claimingRunner ? 'Claiming...' : 'Claim Runner Rewards'}
              </button>
            </div>
          );
        })()}
        {runnerClaimStatus && (
          <div style={{ fontSize: '0.75rem', color: '#ffaa00', marginTop: 6, textAlign: 'center' }}>{runnerClaimStatus}</div>
        )}
      </div>

      {/* Tab Switcher */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
        <button
          onClick={() => setTab('positions')}
          style={{
            flex: 1, padding: '10px', borderRadius: '8px', border: '1px solid #2a2a4a',
            background: tab === 'positions' ? 'rgba(0,255,136,0.15)' : 'transparent',
            color: tab === 'positions' ? 'var(--neon-green)' : '#888',
            cursor: 'pointer', fontFamily: 'Orbitron, monospace', fontWeight: 'bold', fontSize: '0.82rem',
          }}
        >
          Active Positions
        </button>
        <button
          onClick={() => setTab('history')}
          style={{
            flex: 1, padding: '10px', borderRadius: '8px', border: '1px solid #2a2a4a',
            background: tab === 'history' ? 'rgba(0,255,136,0.15)' : 'transparent',
            color: tab === 'history' ? 'var(--neon-green)' : '#888',
            cursor: 'pointer', fontFamily: 'Orbitron, monospace', fontWeight: 'bold', fontSize: '0.82rem',
          }}
        >
          History
        </button>
        <button
          onClick={() => setTab('mybots')}
          style={{
            flex: 1, padding: '10px', borderRadius: '8px', border: '1px solid #2a2a4a',
            background: tab === 'mybots' ? 'rgba(0,255,136,0.15)' : 'transparent',
            color: tab === 'mybots' ? 'var(--neon-green)' : '#888',
            cursor: 'pointer', fontFamily: 'Orbitron, monospace', fontWeight: 'bold', fontSize: '0.82rem',
          }}
        >
          My Bots
        </button>
      </div>

      {/* Content */}
      {loading ? (
        <div className="panel-card muted" style={{ textAlign: 'center', padding: 24 }}>Loading...</div>
      ) : tab === 'positions' ? (
        <div className="panel-section">
          <h3>Active Positions</h3>
          {(!data?.activePositions || data.activePositions.length === 0) ? (
            <div className="panel-card muted">No active positions</div>
          ) : (
            <ul className="fighter-list">
              {data.activePositions.map((p: any, i: number) => (
                <li key={`${p.matchId}-${p.botId}` || i} className="fighter-item alive" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span className="fighter-name">
                    Match {p.displayMatchId} &middot; {p.botId}
                  </span>
                  <span style={{ display: 'flex', gap: '12px', fontSize: '0.8rem' }}>
                    <span style={{ color: 'var(--neon-blue)' }}>{p.amount} USDC</span>
                    <span className="muted">Pool: {p.poolTotal}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : tab === 'history' ? (
        <div className="panel-section">
          <h3>Bet History</h3>
          {(!data?.betHistory || data.betHistory.length === 0) ? (
            <div className="panel-card muted">No bet history</div>
          ) : (
            <ul className="fighter-list">
              {data.betHistory.map((h: any, i: number) => (
                <li key={h.ts || i} className="fighter-item alive" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span className="fighter-name" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{
                      width: 8, height: 8, borderRadius: '50%', display: 'inline-block',
                      background: h.type === 'bet_win' ? 'var(--neon-green)' : '#ff4466',
                    }} />
                    {h.type === 'bet_win' ? 'Win' : h.type === 'bet_place' ? 'Bet' : h.type === 'bet_activity' ? 'Bet' : h.type}
                    {h.displayMatchId ? ` #${h.displayMatchId}` : ''}
                  </span>
                  <span style={{
                    color: h.type === 'bet_win' ? 'var(--neon-green)' : '#ff4466',
                    fontWeight: 'bold', fontSize: '0.85rem',
                  }}>
                    {h.type === 'bet_win' ? '+' : '-'}{h.amount} {typeof h.amount === 'number' && h.amount > 100 ? 'pts' : 'USDC'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : tab === 'mybots' ? (
        <div className="panel-section">
          <h3>My Bots (NFTs)</h3>
          {botsLoading ? (
            <div className="panel-card muted" style={{ textAlign: 'center', padding: 24 }}>Loading...</div>
          ) : myBots.length === 0 ? (
            <div className="panel-card muted">No bots found for this wallet</div>
          ) : (
            <ul className="fighter-list">
              {myBots.map((b: any, i: number) => (
                <li key={b.botId || i} className="fighter-item alive" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span className="fighter-name">{b.botName || b.name || b.botId}</span>
                  <span style={{ display: 'flex', gap: '12px', fontSize: '0.8rem' }}>
                    <span style={{ color: 'var(--neon-green)' }}>{b.wins}W</span>
                    <span className="muted">{b.matchesPlayed || 0} played</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

// Full-page Marketplace view — reads from BotMarketplace escrow contract
function MarketplacePage() {
  const { isConnected, address, chain } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const { switchChainAsync } = useSwitchChain();
  const [listings, setListings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState<number | null>(null);
  const [actionStatus, setActionStatus] = useState('');
  const actionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadListings = async () => {
    try {
      const res = await fetch('/api/marketplace/listings?offset=0&limit=50');
      if (res.ok) {
        const data = await res.json();
        setListings(data.listings || []);
      }
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  useEffect(() => {
    loadListings();
    const t = setInterval(loadListings, 30000);
    return () => clearInterval(t);
  }, []);

  const handleBuy = async (item: any) => {
    if (!isConnected || !address) return alert('Please connect wallet first');
    if (chain?.id !== baseSepolia.id) {
      try { await switchChainAsync({ chainId: baseSepolia.id }); } catch { return alert('Please switch to Base Sepolia'); }
    }
    const tokenId = item.tokenId;
    const priceWei = item.priceWei;
    if (!priceWei || priceWei === '0') return alert('Invalid price');
    setActionId(tokenId);
    setActionStatus('Signing transaction...');
    try {
      const buyGas = await estimateGas({
        address: CONTRACTS.botMarketplace as `0x${string}`,
        abi: BOT_MARKETPLACE_ABI,
        functionName: 'buy',
        args: [BigInt(tokenId)],
        value: BigInt(priceWei),
        account: address as `0x${string}`,
      });
      const txHash = await writeContractAsync({
        address: CONTRACTS.botMarketplace as `0x${string}`,
        abi: BOT_MARKETPLACE_ABI,
        functionName: 'buy',
        args: [BigInt(tokenId)],
        value: BigInt(priceWei),
        chainId: baseSepolia.id,
        ...(buyGas ? { gas: buyGas } : {}),
      });
      setActionStatus('Confirming...');
      await publicClient.waitForTransactionReceipt({ hash: txHash as `0x${string}` });
      setActionStatus('Purchased! Updating ownership...');
      // Notify server to update local ownership based on NFT
      if (item.botId) {
        try {
          await fetch('/api/bot/claim-nft', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ botId: item.botId, address, txHash }),
          });
        } catch (claimErr) {
          console.warn('[Marketplace] claim-nft failed:', claimErr);
        }
      }
      setActionStatus('Done!');
      await loadListings();
    } catch (e: any) {
      setActionStatus(e?.shortMessage || e?.message || 'Transaction failed');
    }
    if (actionTimerRef.current) clearTimeout(actionTimerRef.current);
    actionTimerRef.current = setTimeout(() => { setActionId(null); setActionStatus(''); }, 3000);
  };

  const handleCancel = async (item: any) => {
    if (!isConnected) return alert('Connect wallet first');
    if (chain?.id !== baseSepolia.id) {
      try { await switchChainAsync({ chainId: baseSepolia.id }); } catch { return alert('Please switch to Base Sepolia'); }
    }
    setActionId(item.tokenId);
    setActionStatus('Cancelling...');
    try {
      const cancelGas = await estimateGas({
        address: CONTRACTS.botMarketplace as `0x${string}`,
        abi: BOT_MARKETPLACE_ABI,
        functionName: 'cancel',
        args: [BigInt(item.tokenId)],
        account: address as `0x${string}`,
      });
      const txHash = await writeContractAsync({
        address: CONTRACTS.botMarketplace as `0x${string}`,
        abi: BOT_MARKETPLACE_ABI,
        functionName: 'cancel',
        args: [BigInt(item.tokenId)],
        chainId: baseSepolia.id,
        ...(cancelGas ? { gas: cancelGas } : {}),
      });
      setActionStatus('Confirming...');
      await publicClient.waitForTransactionReceipt({ hash: txHash as `0x${string}` });
      setActionStatus('Cancelled! NFT returned.');
      await loadListings();
    } catch (e: any) {
      setActionStatus(e?.shortMessage || e?.message || 'Cancel failed');
    }
    if (actionTimerRef.current) clearTimeout(actionTimerRef.current);
    actionTimerRef.current = setTimeout(() => { setActionId(null); setActionStatus(''); }, 3000);
  };

  return (
    <div style={{ padding: '24px', width: '100%', maxWidth: '800px', margin: '0 auto' }}>
      <h2 style={{ color: 'var(--neon-pink)', textAlign: 'center', marginBottom: '20px' }}>🏪 Bot Marketplace</h2>
      <div className="muted" style={{ textAlign: 'center', marginBottom: '16px', fontSize: '0.8rem' }}>
        NFT escrow marketplace — bots are held in contract until sold or cancelled. 2.5% fee.
      </div>

      <div className="panel-section">
        {loading ? (
          <div className="panel-card muted">Loading marketplace...</div>
        ) : listings.length === 0 ? (
          <div className="panel-card">
            <div className="muted" style={{ textAlign: 'center', padding: '24px 0' }}>
              <div style={{ fontSize: '2rem', marginBottom: '12px' }}>🏪</div>
              <p>No bots are currently listed for sale.</p>
              <p style={{ fontSize: '0.8rem', marginTop: '8px' }}>
                List your bot from the "My Bots" panel using the Sell button.
              </p>
            </div>
          </div>
        ) : (
          <div>
            {listings.map((item, i) => {
              const isSeller = address && item.seller && item.seller.toLowerCase() === address.toLowerCase();
              return (
                <div key={item.tokenId || i} className="panel-card" style={{ marginBottom: '8px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontWeight: 'bold', fontSize: '1rem' }}>{item.botName || `Token #${item.tokenId}`}</div>
                      <div className="muted" style={{ fontSize: '0.75rem' }}>
                        Seller: {item.seller ? (item.seller.slice(0, 6) + '...' + item.seller.slice(-4)) : 'unknown'}
                        {item.matchesPlayed ? ` | ${item.matchesPlayed} matches` : ''}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ color: 'var(--neon-pink)', fontWeight: 'bold', fontSize: '1.1rem' }}>{item.price} ETH</div>
                      {isConnected && (
                        <div style={{ display: 'flex', gap: '4px', justifyContent: 'flex-end', marginTop: '4px' }}>
                          {isSeller ? (
                            <button
                              onClick={() => handleCancel(item)}
                              disabled={actionId === item.tokenId}
                              style={{ fontSize: '0.75rem', padding: '4px 12px', background: '#333', color: '#ff8800' }}
                            >
                              {actionId === item.tokenId ? (actionStatus || '...') : 'Cancel'}
                            </button>
                          ) : (
                            <button
                              onClick={() => handleBuy(item)}
                              disabled={actionId === item.tokenId}
                              style={{ fontSize: '0.75rem', padding: '4px 12px' }}
                            >
                              {actionId === item.tokenId ? (actionStatus || '...') : `Buy (${item.price} ETH)`}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
            {actionStatus && actionId !== null && <div className="muted" style={{ textAlign: 'center', marginTop: '8px' }}>{actionStatus}</div>}
          </div>
        )}
      </div>
    </div>
  );
}

function ReplayPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const foodImgRef = useRef<HTMLImageElement | null>(null);
  useEffect(() => {
    const img = new Image();
    img.src = foodSvgUrl;
    img.onload = () => { foodImgRef.current = img; };
  }, []);

  const replayRef = useRef<any>(null);
  const [replayLoaded, setReplayLoaded] = useState(false);
  const [replayList, setReplayList] = useState<any[]>([]);
  const [searchInput, setSearchInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [players, setPlayers] = useState<any[]>([]);
  const [frameLabel, setFrameLabel] = useState('0 / 0');
  const [matchInfo, setMatchInfo] = useState('');
  const [timer, setTimer] = useState('--:--');
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);

  const frameIndexRef = useRef(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const speedRef = useRef(1);

  // Refs for state that the draw function needs to update
  const setPlayersRef = useRef(setPlayers);
  const setTimerRef = useRef(setTimer);
  const setFrameLabelRef = useRef(setFrameLabel);
  setPlayersRef.current = setPlayers;
  setTimerRef.current = setTimer;
  setFrameLabelRef.current = setFrameLabel;

  useEffect(() => {
    fetch('/api/replays').then(r => r.json()).then(setReplayList).catch(() => {});
  }, []);

  // Stable draw function via useCallback - only depends on refs
  const drawFrame = useCallback((idx: number) => {
    const rd = replayRef.current;
    if (!rd?.frames?.length) return;
    if (idx < 0 || idx >= rd.frames.length) return;
    const frame = rd.frames[idx];
    if (!frame) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const w = 600, h = 600;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cellSize = w / 30;

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);

    const isComp = (rd.arenaId || '').includes('competitive');
    ctx.strokeStyle = isComp ? '#1a1020' : '#1a1a2e';
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= 30; i++) {
      ctx.beginPath(); ctx.moveTo(i * cellSize, 0); ctx.lineTo(i * cellSize, h); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i * cellSize); ctx.lineTo(w, i * cellSize); ctx.stroke();
    }

    if (frame.obstacles?.length) {
      for (const obs of frame.obstacles) {
        if (obs.solid) {
          ctx.fillStyle = '#8b0000'; ctx.shadowColor = '#ff0000'; ctx.shadowBlur = 4;
          ctx.fillRect(obs.x * cellSize, obs.y * cellSize, cellSize, cellSize);
          ctx.shadowBlur = 0; ctx.strokeStyle = '#ff4444'; ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(obs.x * cellSize + 2, obs.y * cellSize + 2);
          ctx.lineTo((obs.x + 1) * cellSize - 2, (obs.y + 1) * cellSize - 2);
          ctx.moveTo((obs.x + 1) * cellSize - 2, obs.y * cellSize + 2);
          ctx.lineTo(obs.x * cellSize + 2, (obs.y + 1) * cellSize - 2);
          ctx.stroke();
        } else {
          ctx.fillStyle = 'rgba(255, 200, 0, 0.4)';
          ctx.fillRect(obs.x * cellSize, obs.y * cellSize, cellSize, cellSize);
          ctx.strokeStyle = 'rgba(255, 200, 0, 0.8)'; ctx.lineWidth = 1;
          ctx.strokeRect(obs.x * cellSize, obs.y * cellSize, cellSize, cellSize);
        }
      }
    }

    (frame.food || []).forEach((f: any) => {
      if (foodImgRef.current) {
        const pad = cellSize * 0.1;
        ctx.drawImage(foodImgRef.current, f.x * cellSize + pad, f.y * cellSize + pad, cellSize - pad * 2, cellSize - pad * 2);
      } else {
        ctx.fillStyle = '#ff0055'; ctx.shadowColor = '#ff0055'; ctx.shadowBlur = 10;
        ctx.beginPath(); ctx.arc(f.x * cellSize + cellSize / 2, f.y * cellSize + cellSize / 2, cellSize / 3, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;
      }
    });

    (frame.players || []).forEach((p: any) => {
      if (!p.body || p.body.length === 0) return;
      ctx.fillStyle = p.color || '#00ff88'; ctx.shadowColor = p.color || '#00ff88';
      ctx.shadowBlur = p.alive ? 8 : 0; ctx.globalAlpha = p.alive ? 1 : 0.4;
      const pName = p.name || '';
      p.body.forEach((seg: any, i: number) => {
        if (i === 0) return;
        ctx.fillRect(seg.x * cellSize + 1, seg.y * cellSize + 1, cellSize - 2, cellSize - 2);
        const letterIdx = i - 1;
        if (letterIdx < pName.length && pName[letterIdx]) {
          ctx.save(); ctx.fillStyle = '#000'; ctx.shadowBlur = 0;
          ctx.globalAlpha = p.alive ? 0.8 : 0.3;
          ctx.font = `bold ${Math.max(cellSize * 0.6, 8)}px Orbitron, monospace`;
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(pName[letterIdx], seg.x * cellSize + cellSize / 2, seg.y * cellSize + cellSize / 2 + 1);
          ctx.restore();
          ctx.fillStyle = p.color || '#00ff88'; ctx.shadowColor = p.color || '#00ff88';
          ctx.shadowBlur = p.alive ? 8 : 0; ctx.globalAlpha = p.alive ? 1 : 0.4;
        }
      });
      const head = p.body[0];
      let dir = { x: 1, y: 0 };
      if (p.body.length >= 2) {
        const neck = p.body[1];
        const dx = head.x - neck.x, dy = head.y - neck.y;
        if (dx !== 0 || dy !== 0) dir = { x: Math.sign(dx), y: Math.sign(dy) };
      }
      const cx = head.x * cellSize + cellSize / 2, cy = head.y * cellSize + cellSize / 2;
      const sz = cellSize / 2 - 1;
      ctx.beginPath();
      if (dir.x === 1 && dir.y === 0) { ctx.moveTo(cx + sz, cy); ctx.lineTo(cx - sz, cy - sz); ctx.lineTo(cx - sz, cy + sz); }
      else if (dir.x === -1 && dir.y === 0) { ctx.moveTo(cx - sz, cy); ctx.lineTo(cx + sz, cy - sz); ctx.lineTo(cx + sz, cy + sz); }
      else if (dir.y === -1) { ctx.moveTo(cx, cy - sz); ctx.lineTo(cx - sz, cy + sz); ctx.lineTo(cx + sz, cy + sz); }
      else { ctx.moveTo(cx, cy + sz); ctx.lineTo(cx - sz, cy - sz); ctx.lineTo(cx + sz, cy - sz); }
      ctx.closePath(); ctx.fill();
      // HP bar in replay
      if (p.alive && p.hp != null) {
        const barW = cellSize * 1.2, barH = Math.max(2, cellSize * 0.15);
        const barX = head.x * cellSize + cellSize / 2 - barW / 2;
        const barY = head.y * cellSize - barH - 2;
        const hpRatio = Math.max(0, Math.min(1, p.hp / 100));
        ctx.save(); ctx.shadowBlur = 0;
        ctx.globalAlpha = 0.6; ctx.fillStyle = '#333'; ctx.fillRect(barX, barY, barW, barH);
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = hpRatio > 0.5 ? `rgb(${Math.round((1-hpRatio)*2*255)},255,0)` : `rgb(255,${Math.round(hpRatio*2*255)},0)`;
        ctx.fillRect(barX, barY, barW * hpRatio, barH);
        ctx.restore(); ctx.fillStyle = p.color || '#00ff88';
      }
      ctx.shadowBlur = 0; ctx.globalAlpha = 1;
    });

    // Frame overlay on canvas
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, 0, 140, 22);
    ctx.fillStyle = '#0ff';
    ctx.font = 'bold 13px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(`Frame ${idx + 1} / ${rd.frames.length}`, 6, 4);
    ctx.restore();

    setPlayersRef.current([...(frame.players || [])]);
    if (frame.matchTimeLeft != null) {
      const min = Math.floor(frame.matchTimeLeft / 60);
      const sec = frame.matchTimeLeft % 60;
      setTimerRef.current(`${min}:${sec.toString().padStart(2, '0')}`);
    }
    setFrameLabelRef.current(`${idx + 1} / ${rd.frames.length}`);
  }, []);

  // Imperative stop: clears interval, updates state
  const stopPlayback = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setPlaying(false);
  }, []);

  // Imperative start: creates interval that advances frames
  const startPlayback = useCallback(() => {
    // Clear any existing interval first
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setPlaying(true);
    const ms = speedRef.current === 2 ? 62 : 125;
    intervalRef.current = setInterval(() => {
      const rd = replayRef.current;
      if (!rd?.frames?.length) {
        if (intervalRef.current) clearInterval(intervalRef.current);
        intervalRef.current = null;
        setPlaying(false);
        return;
      }
      const nextIdx = frameIndexRef.current + 1;
      if (nextIdx >= rd.frames.length) {
        if (intervalRef.current) clearInterval(intervalRef.current);
        intervalRef.current = null;
        setPlaying(false);
        return;
      }
      frameIndexRef.current = nextIdx;
      drawFrame(nextIdx);
    }, ms);
  }, [drawFrame]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  const loadReplay = async (matchId: string) => {
    if (!matchId.trim()) return;
    stopPlayback();
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/replay/${encodeURIComponent(matchId.trim())}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Replay not found');
      }
      const data = await res.json();
      replayRef.current = data;
      frameIndexRef.current = 0;
      setReplayLoaded(true);
      setMatchInfo(`${data.displayMatchId || '#' + data.matchId} — ${data.arenaId || ''}`);
      setLoading(false);
      // Draw first frame - call directly and also via rAF as backup
      drawFrame(0);
      requestAnimationFrame(() => drawFrame(0));
    } catch (e: any) {
      setError(e.message || 'Failed to load replay');
      replayRef.current = null;
      setReplayLoaded(false);
      setLoading(false);
    }
  };

  const handlePlay = () => startPlayback();
  const handlePause = () => stopPlayback();
  const handleStop = () => {
    stopPlayback();
    frameIndexRef.current = 0;
    drawFrame(0);
  };
  const handleNextFrame = () => {
    stopPlayback();
    const rd = replayRef.current;
    if (!rd?.frames?.length) return;
    let idx = frameIndexRef.current + 1;
    if (idx >= rd.frames.length) idx = rd.frames.length - 1;
    frameIndexRef.current = idx;
    drawFrame(idx);
  };
  const handleSpeedToggle = () => {
    const s = speedRef.current === 1 ? 2 : 1;
    speedRef.current = s;
    setSpeed(s);
    // If currently playing, restart with new speed
    if (intervalRef.current) {
      startPlayback();
    }
  };

  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;

  return (
    <div className="content">
      <aside className="left-panel">
        <div className="panel-section">
          <h3>🎬 Recent Matches</h3>
          <ul className="fighter-list" style={{ maxHeight: '70vh', overflowY: 'auto' }}>
            {replayList.map((r: any, i: number) => (
              <li key={r.matchId || i} className="fighter-item alive" style={{ cursor: 'pointer' }} onClick={() => { setSearchInput(r.displayMatchId || String(r.matchId)); loadReplay(r.displayMatchId || String(r.matchId)); }}>
                <span className="fighter-name">{r.displayMatchId || `#${r.matchId}`}</span>
                <span className="fighter-length" style={{ fontSize: '11px' }}>{r.winner || 'No winner'}</span>
              </li>
            ))}
            {replayList.length === 0 && <li className="fighter-item"><span className="muted">No replays yet</span></li>}
          </ul>
        </div>
      </aside>

      <div className="main-stage">
        <h1 style={{ color: 'var(--neon-blue)' }}>🎬 REPLAY</h1>
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', marginBottom: '8px', flexWrap: 'wrap' }}>
          <input
            type="text"
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') loadReplay(searchInput); }}
            placeholder="Match ID (e.g. P1400)"
            style={{ padding: '6px 12px', background: '#111', border: '1px solid #333', color: '#fff', borderRadius: '6px', fontFamily: 'Orbitron, monospace', fontSize: '13px', width: '180px' }}
          />
          <button
            onClick={() => loadReplay(searchInput)}
            disabled={loading}
            style={{ padding: '6px 16px', background: 'var(--neon-green)', color: '#000', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer', fontFamily: 'Orbitron, monospace', fontSize: '13px' }}
          >
            {loading ? '...' : 'Search'}
          </button>
        </div>
        {error && <div style={{ color: '#ff4466', textAlign: 'center', marginBottom: '8px', fontSize: '13px' }}>{error}</div>}
        {matchInfo && <div className="match-info">{matchInfo}</div>}
        {replayLoaded && <div className="timer" style={{ color: '#ff8800' }}>{timer}</div>}
        <div className="canvas-wrap">
          <canvas ref={canvasRef} width={600 * dpr} height={600 * dpr}
            style={{ width: 'min(600px, 90vw, 70vh)', height: 'min(600px, 90vw, 70vh)', border: '4px solid var(--neon-blue)', background: '#000' }} />
        </div>
        {replayLoaded && (
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', marginTop: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
            <button onClick={handleStop} style={controlBtnStyle} title="Stop (reset)">⏹</button>
            <button onClick={playing ? handlePause : handlePlay} style={controlBtnStyle} title={playing ? 'Pause' : 'Play'}>
              {playing ? '⏸' : '▶️'}
            </button>
            <button onClick={handleNextFrame} style={controlBtnStyle} title="Next frame">⏭</button>
            <button onClick={handleSpeedToggle} style={{ ...controlBtnStyle, minWidth: '48px', fontSize: '12px' }} title="Toggle speed">
              {speed}x
            </button>
            <span style={{ color: '#888', fontFamily: 'Orbitron, monospace', fontSize: '12px' }}>{frameLabel}</span>
          </div>
        )}
      </div>

      <aside className="right-panel">
        <div className="panel-section">
          <h3>⚔️ Fighters</h3>
          <ul className="fighter-list">
            {[...players].sort((a, b) => (b.body?.length || 0) - (a.body?.length || 0)).map((p: any, i: number) => (
              <li key={p.id || i} className={`fighter-item ${p.alive ? 'alive' : 'dead'}`}>
                <span className="fighter-name" style={{ color: p.color }}>{p.name}</span>
                <span className="fighter-length">{p.hp != null && p.alive ? `${p.hp}hp ` : ''}{p.body?.length || 0} {p.alive ? '🐍' : '💀'}</span>
              </li>
            ))}
            {players.length === 0 && <li className="fighter-item"><span className="muted">Load a replay</span></li>}
          </ul>
        </div>
      </aside>
    </div>
  );
}

const controlBtnStyle: React.CSSProperties = {
  padding: '6px 12px',
  background: '#222',
  color: '#fff',
  border: '1px solid #444',
  borderRadius: '6px',
  cursor: 'pointer',
  fontSize: '16px',
  fontFamily: 'Orbitron, monospace',
};

function App() {
  const [, setMatchId] = useState<number | null>(null);
  const [displayMatchId, setDisplayMatchId] = useState<string | null>(null);
  const [nextMatch, setNextMatch] = useState<{ matchId: number; displayMatchId: string; chainCreated?: boolean } | null>(null);
  const [epoch, setEpoch] = useState(1);
  const [players, setPlayers] = useState<any[]>([]);
  const [bettingOpen, setBettingOpen] = useState(false);
  const [perfLeaderboard, setPerfLeaderboard] = useState<any[]>([]);
  const [compLeaderboard, setCompLeaderboard] = useState<any[]>([]);
  const [perfLeaderboardAll, setPerfLeaderboardAll] = useState<any[]>([]);
  const [compLeaderboardAll, setCompLeaderboardAll] = useState<any[]>([]);
  const [lbEpoch, setLbEpoch] = useState(1);
  const [lbTab, setLbTab] = useState<'epoch' | 'all'>('epoch');
  const [activePage, setActivePage] = useState<'performance' | 'competitive' | 'leaderboard' | 'points' | 'marketplace' | 'portfolio' | 'replay'>('performance');

  const playersRef = useRef<any[]>([]);
  const lastPlayersUpdate = useRef(0);
  const trailingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const throttledSetPlayers = useRef((p: any[]) => {
    playersRef.current = p;
    const now = Date.now();
    if (now - lastPlayersUpdate.current > 500) {
      lastPlayersUpdate.current = now;
      setPlayers(p);
      if (trailingTimer.current) clearTimeout(trailingTimer.current);
    } else {
      if (trailingTimer.current) clearTimeout(trailingTimer.current);
      trailingTimer.current = setTimeout(() => {
        lastPlayersUpdate.current = Date.now();
        setPlayers(playersRef.current);
      }, 500);
    }
  }).current;

  const matchIdRef = useRef<number | null>(null);
  const throttledSetMatchId = useRef((id: number | null) => {
    if (matchIdRef.current !== id) {
      matchIdRef.current = id;
      setMatchId(id);
    }
  }).current;

  const needsLeaderboard = activePage === 'leaderboard' || activePage === 'performance' || activePage === 'competitive';
  useEffect(() => {
    if (!needsLeaderboard) return;
    const load = async () => {
      try {
        const res = await fetch('/api/init');
        if (res.ok) {
          const data = await res.json();
          setPerfLeaderboard(data.perfLeaderboard || []);
          setCompLeaderboard(data.compLeaderboard || []);
          setPerfLeaderboardAll(data.perfLeaderboardAll || []);
          setCompLeaderboardAll(data.compLeaderboardAll || []);
          if (data.epoch) setLbEpoch(data.epoch);
        }
      } catch (_e) {}
    };
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [needsLeaderboard]);

  const isCompetitive = activePage === 'competitive';

  const switchPage = (page: typeof activePage) => {
    setPlayers([]);
    setMatchId(null);
    setDisplayMatchId(null);
    setNextMatch(null);
    setActivePage(page);
  };

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
          <div className="app">
            <header className="top-tabs">
              <button className={`tab ${activePage === 'performance' ? 'active' : ''}`} onClick={() => switchPage('performance')}>🦀 表演场</button>
              <button className={`tab tab-competitive ${activePage === 'competitive' ? 'active' : ''}`} onClick={() => switchPage('competitive')}>⚔️ 竞技场</button>
              <button className={`tab ${activePage === 'leaderboard' ? 'active' : ''}`} onClick={() => switchPage('leaderboard')}>🏆 排行榜</button>
              <button className={`tab ${activePage === 'points' ? 'active' : ''}`} onClick={() => switchPage('points')}>⭐ 积分</button>
              <button className={`tab ${activePage === 'marketplace' ? 'active' : ''}`} onClick={() => switchPage('marketplace')}>🏪 市场</button>
              <button className={`tab ${activePage === 'replay' ? 'active' : ''}`} onClick={() => switchPage('replay')}>🎬 回放</button>
              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <RunnerPoolDisplay />
                <PortfolioButton activePage={activePage} onSwitch={switchPage} />
                <WalletButton />
              </div>
            </header>

            {activePage === 'leaderboard' ? (
              <div className="leaderboard-page">
                <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', padding: '16px 24px 0' }}>
                  <button onClick={() => setLbTab('epoch')} style={{ padding: '6px 16px', fontSize: '0.85rem', background: lbTab === 'epoch' ? 'var(--neon-green)' : 'transparent', color: lbTab === 'epoch' ? '#000' : 'var(--neon-green)', border: '1px solid var(--neon-green)', cursor: 'pointer' }}>
                    Epoch {lbEpoch} (Today)
                  </button>
                  <button onClick={() => setLbTab('all')} style={{ padding: '6px 16px', fontSize: '0.85rem', background: lbTab === 'all' ? 'var(--neon-blue, #0088ff)' : 'transparent', color: lbTab === 'all' ? '#000' : 'var(--neon-blue, #0088ff)', border: '1px solid var(--neon-blue, #0088ff)', cursor: 'pointer' }}>
                    All Time
                  </button>
                </div>
                <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap', justifyContent: 'center', padding: '16px 24px 24px', width: '100%', maxWidth: '900px', margin: '0 auto' }}>
                  <div className="panel-section" style={{ flex: 1, minWidth: '280px' }}>
                    <h2 style={{ color: 'var(--neon-green)', textAlign: 'center' }}>Performance</h2>
                    <ul className="fighter-list">
                      {(lbTab === 'epoch' ? perfLeaderboard : perfLeaderboardAll).map((p: any, i: number) => (
                        <li key={p.name || i} className="fighter-item alive">
                          <span className="fighter-name">
                            {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i+1}`} {p.name}
                          </span>
                          <span className="fighter-length">{p.wins}W</span>
                        </li>
                      ))}
                      {(lbTab === 'epoch' ? perfLeaderboard : perfLeaderboardAll).length === 0 && <li className="fighter-item"><span className="muted">No data yet</span></li>}
                    </ul>
                  </div>
                  <div className="panel-section" style={{ flex: 1, minWidth: '280px' }}>
                    <h2 style={{ color: 'var(--neon-pink)', textAlign: 'center' }}>Competitive</h2>
                    <ul className="fighter-list">
                      {(lbTab === 'epoch' ? compLeaderboard : compLeaderboardAll).map((p: any, i: number) => (
                        <li key={p.name || i} className="fighter-item alive">
                          <span className="fighter-name">
                            {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i+1}`} {p.name}
                          </span>
                          <span className="fighter-length">{p.wins}W</span>
                        </li>
                      ))}
                      {(lbTab === 'epoch' ? compLeaderboard : compLeaderboardAll).length === 0 && <li className="fighter-item"><span className="muted">No data yet</span></li>}
                    </ul>
                  </div>
                </div>
              </div>
            ) : activePage === 'points' ? (
              <PointsPage />
            ) : activePage === 'marketplace' ? (
              <MarketplacePage />
            ) : activePage === 'portfolio' ? (
              <PortfolioPage />
            ) : activePage === 'replay' ? (
              <ReplayPage />
            ) : (
              <div className={`content`}>
                <aside className="left-panel">
                  <div className="panel-section">
                    <h3>🤖 Bot Management</h3>
                    <BotManagement />
                  </div>
                  {isCompetitive && (
                    <div className="panel-section">
                      <h3>🎯 Arena Entry</h3>
                      <CompetitiveEnter displayMatchId={displayMatchId} />
                    </div>
                  )}
                  <div className="panel-section">
                    <h3>🔮 Prediction</h3>
                    <Prediction displayMatchId={displayMatchId} nextMatch={nextMatch} epoch={epoch} arenaType={activePage as 'performance' | 'competitive'} bettingOpen={bettingOpen} arenaId={isCompetitive ? 'competitive-1' : `performance-${displayMatchId ? displayMatchId.charAt(0) : 'A'}`} />
                  </div>
                </aside>

                <GameCanvas
                  key={activePage}
                  mode={activePage as any}
                  setMatchId={throttledSetMatchId}
                  setPlayers={throttledSetPlayers}
                  setDisplayMatchId={setDisplayMatchId}
                  setNextMatch={setNextMatch}
                  setEpoch={setEpoch}
                  setBettingOpen={setBettingOpen}
                />

                <aside className="right-panel">
                  <div className="panel-section">
                    <h3>⚔️ Fighters</h3>
                    <ul className="fighter-list">
                      {[...players].filter(p => !p.waiting).sort((a, b) => (b.body?.length || 0) - (a.body?.length || 0)).map((p, i) => (
                        <li key={p.id || i} className={`fighter-item ${p.alive ? 'alive' : 'dead'}`}>
                          <span className="fighter-name" style={{ color: p.color }}>{p.name}</span>
                          <span className="fighter-length">{p.hp != null && p.alive ? `${p.hp}hp ` : ''}{p.body?.length || 0} {p.alive ? '🐍' : '💀'}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="panel-section">
                      <h3>🏆 {isCompetitive ? 'Competitive' : 'Performance'} Leaderboard</h3>
                      <ul className="fighter-list">
                        {(isCompetitive ? compLeaderboard : perfLeaderboard).slice(0, 10).map((p: any, i: number) => (
                          <li key={p.name || i} className="fighter-item">
                            <span className="fighter-name">{p.name}</span>
                            <span className="fighter-length">{p.wins}W</span>
                          </li>
                        ))}
                      </ul>
                  </div>
                </aside>
              </div>
            )}
          </div>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean; error: Error | null }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 40, textAlign: 'center', color: '#ff4466', fontFamily: 'Orbitron, monospace' }}>
          <h2>Something went wrong</h2>
          <p style={{ color: '#888' }}>{this.state.error?.message}</p>
          <button onClick={() => window.location.reload()} style={{ marginTop: 20, padding: '8px 24px', background: 'var(--neon-green)', color: '#000', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 'bold' }}>
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function AppWithBoundary() {
  return (
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );
}

export default AppWithBoundary;
