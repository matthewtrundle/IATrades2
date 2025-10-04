export interface TokenConfig {
  symbol: string;
  mint: string;
  decimals: number;
  name: string;
}

export const TOKENS: Record<string, TokenConfig> = {
  SOL: {
    symbol: 'SOL',
    mint: 'So11111111111111111111111111111111111111112',
    decimals: 9,
    name: 'Solana'
  },
  USDC: {
    symbol: 'USDC',
    mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    decimals: 6,
    name: 'USD Coin'
  },
  FARTCOIN: {
    symbol: 'FARTCOIN',
    mint: '9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump',
    decimals: 6,
    name: 'Fartcoin'
  },
  FARTBOY: {
    symbol: 'FARTBOY',
    mint: 'y1AZt42vceCmStjW4zetK3VoNarC1VxJ5iDjpiupump',
    decimals: 6,
    name: 'Fartboy'
  },
  USELESS: {
    symbol: 'USELESS',
    mint: 'Dz9mQ9NzkBcCsuGPFJ3r1bS4wgqKMHBPiVuniW8Mbonk',
    decimals: 6,
    name: 'Useless'
  }
};

export function getMintAddress(symbol: string): string {
  const token = TOKENS[symbol.toUpperCase()];
  if (!token) {
    throw new Error(`Unknown token symbol: ${symbol}`);
  }
  return token.mint;
}

export function getTokenDecimals(symbol: string): number {
  const token = TOKENS[symbol.toUpperCase()];
  if (!token) {
    throw new Error(`Unknown token symbol: ${symbol}`);
  }
  return token.decimals;
}

export function getTokenConfig(symbol: string): TokenConfig {
  const token = TOKENS[symbol.toUpperCase()];
  if (!token) {
    throw new Error(`Unknown token symbol: ${symbol}`);
  }
  return token;
}
