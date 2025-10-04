import { Keypair } from '@solana/web3.js';
import * as crypto from 'crypto';
import dotenv from 'dotenv';

dotenv.config();

export function generateKeypairFromSeed(suffix: string): Keypair {
  const operationalSeed = process.env.OPERATIONAL_SEED;
  
  if (!operationalSeed) {
    throw new Error('OPERATIONAL_SEED not found in environment variables');
  }

  // Decode base64 seed
  const seedBuffer = Buffer.from(operationalSeed, 'base64');
  
  if (seedBuffer.length !== 32) {
    throw new Error('OPERATIONAL_SEED must be 32 bytes');
  }

  // Derive wallet from seed + suffix
  const derivedSeed = crypto
    .createHash('sha256')
    .update(seedBuffer)
    .update(suffix)
    .digest()
    .slice(0, 32);

  return Keypair.fromSeed(derivedSeed);
}

export type WalletType = 'sol_30m' | 'sol_60m' | 'sol_240m' | 'fartcoin' | 'fartboy' | 'useless';

export function getWalletForType(type: WalletType): Keypair {
  return generateKeypairFromSeed(type);
}

export function getAllWallets(): Record<WalletType, Keypair> {
  return {
    sol_30m: getWalletForType('sol_30m'),
    sol_60m: getWalletForType('sol_60m'),
    sol_240m: getWalletForType('sol_240m'),
    fartcoin: getWalletForType('fartcoin'),
    fartboy: getWalletForType('fartboy'),
    useless: getWalletForType('useless')
  };
}

export function verifyWalletAddress(type: string, expectedAddress: string): boolean {
  const keypair = generateKeypairFromSeed(type);
  return keypair.publicKey.toString() === expectedAddress;
}
