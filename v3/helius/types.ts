/**
 * Type definitions for Helius on-chain verification system
 */

// ============================================================================
// Enhanced Transaction Types (from Helius API)
// ============================================================================

export interface TokenTransfer {
  fromUserAccount: string;
  toUserAccount: string;
  tokenAmount: number;
  mint: string;
  tokenStandard?: string;
}

export interface NativeTransfer {
  fromUserAccount: string;
  toUserAccount: string;
  amount: number;
}

export interface EnhancedTransaction {
  description: string;
  type: string;
  source: string;
  fee: number;
  feePayer: string;
  signature: string;
  slot: number;
  timestamp: number;
  tokenTransfers?: TokenTransfer[];
  nativeTransfers?: NativeTransfer[];
  accountData?: any[];
  transactionError?: any;
  instructions?: any[];
  events?: any;
}

// ============================================================================
// RPC Types
// ============================================================================

export interface TokenAccountInfo {
  mint: string;
  owner: string;
  tokenAmount: {
    amount: string;
    decimals: number;
    uiAmount: number;
    uiAmountString: string;
  };
}

export interface TokenAccountResponse {
  pubkey: string;
  account: {
    data: {
      parsed: {
        info: TokenAccountInfo;
        type: string;
      };
      program: string;
      space: number;
    };
    executable: boolean;
    lamports: number;
    owner: string;
    rentEpoch: number;
  };
}

export interface RpcResponse<T> {
  jsonrpc: string;
  result: T;
  id: number;
}

// ============================================================================
// Verification Result Types
// ============================================================================

export interface VerifiedTransaction {
  success: boolean;
  signature: string;
  inputAmount: number;
  outputAmount: number;
  inputMint: string;
  outputMint: string;
  actualSlippage: number;
  fee: number;
  timestamp: number;
  error?: string;
  fromWallet: string;
  toWallet: string;
}

export interface BalanceCheck {
  success: boolean;
  walletAddress: string;
  tokenMint: string;
  dbBalance: number;
  onchainBalance: number;
  discrepancy: number;
  hasDiscrepancy: boolean;
  error?: string;
  checkedAt: number;
}

export interface BatchBalanceResult {
  totalChecked: number;
  successCount: number;
  failureCount: number;
  discrepanciesFound: number;
  results: BalanceCheck[];
  errors: string[];
}

// ============================================================================
// Request/Input Types
// ============================================================================

export interface VerifyTransactionRequest {
  signature: string;
  walletAddress: string;
  expectedInputMint?: string;
  expectedOutputMint?: string;
}

export interface BalanceSyncRequest {
  walletAddress: string;
  tokenMint: string;
  expectedBalance: number;
  discrepancyThreshold?: number; // Default: 0.01
}

export interface BatchBalanceSyncRequest {
  wallets: Array<{
    address: string;
    tokenMint: string;
    expectedBalance: number;
  }>;
  discrepancyThreshold?: number;
}

// ============================================================================
// Client Configuration
// ============================================================================

export interface HeliusClientConfig {
  apiKey: string;
  rpcEndpoint?: string;
  rateLimitPerSecond?: number; // Default: 50
  retryAttempts?: number; // Default: 3
  retryDelayMs?: number; // Default: 1000
  cacheTTLSeconds?: number; // Default: 300 (5 minutes)
}

export interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

// ============================================================================
// Error Types
// ============================================================================

export enum VerificationErrorType {
  TRANSACTION_NOT_FOUND = "TRANSACTION_NOT_FOUND",
  INVALID_TRANSFER_PATTERN = "INVALID_TRANSFER_PATTERN",
  NO_TOKEN_ACCOUNTS_FOUND = "NO_TOKEN_ACCOUNTS_FOUND",
  API_ERROR = "API_ERROR",
  RATE_LIMIT_EXCEEDED = "RATE_LIMIT_EXCEEDED",
  INVALID_INPUT = "INVALID_INPUT",
  NETWORK_ERROR = "NETWORK_ERROR",
}

export interface VerificationError {
  type: VerificationErrorType;
  message: string;
  details?: any;
}
