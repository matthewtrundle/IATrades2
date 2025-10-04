/**
 * Helius API Client
 *
 * Production-ready client with:
 * - Rate limiting (50 calls/second default)
 * - Automatic retries with exponential backoff
 * - Response caching (5 minute TTL)
 * - Comprehensive error handling
 *
 * Budget: 10M calls/month - use aggressively for verification
 */

import {
  HeliusClientConfig,
  EnhancedTransaction,
  TokenAccountResponse,
  RpcResponse,
  CacheEntry,
  VerificationErrorType,
} from "./types";

export class HeliusClient {
  private apiKey: string;
  private rpcEndpoint: string;
  private rateLimitPerSecond: number;
  private retryAttempts: number;
  private retryDelayMs: number;
  private cacheTTLSeconds: number;

  // Rate limiting state
  private requestQueue: Array<() => Promise<any>> = [];
  private isProcessingQueue = false;
  private lastRequestTime = 0;
  private requestInterval: number;

  // Cache storage
  private cache = new Map<string, CacheEntry<any>>();

  constructor(config: HeliusClientConfig) {
    this.apiKey = config.apiKey;
    this.rpcEndpoint =
      config.rpcEndpoint ||
      `https://mainnet.helius-rpc.com/?api-key=${this.apiKey}`;
    this.rateLimitPerSecond = config.rateLimitPerSecond || 50;
    this.retryAttempts = config.retryAttempts || 3;
    this.retryDelayMs = config.retryDelayMs || 1000;
    this.cacheTTLSeconds = config.cacheTTLSeconds || 300; // 5 minutes

    // Calculate interval between requests (in ms)
    this.requestInterval = 1000 / this.rateLimitPerSecond;
  }

  /**
   * Fetch enhanced transaction from Helius
   * Returns parsed transaction with human-readable token transfers
   *
   * @param signature - Transaction signature to fetch
   * @returns Enhanced transaction data or null on error
   */
  async getEnhancedTransaction(
    signature: string
  ): Promise<EnhancedTransaction | null> {
    const cacheKey = `tx:${signature}`;

    // Check cache first
    const cached = this.getFromCache<EnhancedTransaction>(cacheKey);
    if (cached) {
      return cached;
    }

    const url = `https://api.helius.xyz/v0/transactions/${signature}?api-key=${this.apiKey}`;

    const response = await this.rateLimitedRequest<EnhancedTransaction>(
      async () => {
        const res = await fetch(url, {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
          },
        });

        if (!res.ok) {
          if (res.status === 404) {
            return null;
          }
          throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        }

        return await res.json();
      }
    );

    // Cache the result if successful
    if (response) {
      this.setCache(cacheKey, response, this.cacheTTLSeconds);
    }

    return response;
  }

  /**
   * Get token accounts for a wallet address
   *
   * @param walletAddress - Owner wallet address
   * @param tokenMint - Optional: filter by specific token mint
   * @returns Array of token account data
   */
  async getTokenAccountsByOwner(
    walletAddress: string,
    tokenMint?: string
  ): Promise<TokenAccountResponse[]> {
    const cacheKey = `accounts:${walletAddress}:${tokenMint || "all"}`;

    // Check cache first (shorter TTL for balances)
    const cached = this.getFromCache<TokenAccountResponse[]>(cacheKey);
    if (cached) {
      return cached;
    }

    const body = tokenMint
      ? {
          jsonrpc: "2.0",
          id: 1,
          method: "getTokenAccountsByOwner",
          params: [
            walletAddress,
            { mint: tokenMint },
            { encoding: "jsonParsed" },
          ],
        }
      : {
          jsonrpc: "2.0",
          id: 1,
          method: "getTokenAccountsByOwner",
          params: [
            walletAddress,
            { programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" }, // SPL Token Program
            { encoding: "jsonParsed" },
          ],
        };

    const response = await this.rateLimitedRequest<
      RpcResponse<{ value: TokenAccountResponse[] }>
    >(async () => {
      const res = await fetch(this.rpcEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }

      return await res.json();
    });

    const accounts = response?.result?.value || [];

    // Cache for 1 minute (balances change frequently)
    this.setCache(cacheKey, accounts, 60);

    return accounts;
  }

  /**
   * Get SOL balance for a wallet
   *
   * @param walletAddress - Wallet address
   * @returns SOL balance in lamports
   */
  async getSolBalance(walletAddress: string): Promise<number> {
    const cacheKey = `sol:${walletAddress}`;

    const cached = this.getFromCache<number>(cacheKey);
    if (cached !== null && cached !== undefined) {
      return cached;
    }

    const body = {
      jsonrpc: "2.0",
      id: 1,
      method: "getBalance",
      params: [walletAddress],
    };

    const response = await this.rateLimitedRequest<
      RpcResponse<{ value: number }>
    >(async () => {
      const res = await fetch(this.rpcEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }

      return await res.json();
    });

    const balance = response?.result?.value || 0;

    // Cache for 1 minute
    this.setCache(cacheKey, balance, 60);

    return balance;
  }

  /**
   * Rate-limited request wrapper with retry logic
   * Ensures we don't exceed API rate limits and handles transient failures
   */
  private async rateLimitedRequest<T>(
    requestFn: () => Promise<T>
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      this.requestQueue.push(async () => {
        let lastError: Error | null = null;

        for (let attempt = 1; attempt <= this.retryAttempts; attempt++) {
          try {
            // Enforce rate limit
            const now = Date.now();
            const timeSinceLastRequest = now - this.lastRequestTime;
            if (timeSinceLastRequest < this.requestInterval) {
              await this.sleep(this.requestInterval - timeSinceLastRequest);
            }

            this.lastRequestTime = Date.now();

            // Execute request
            const result = await requestFn();
            resolve(result);
            return;
          } catch (error) {
            lastError = error as Error;

            // Don't retry on 404 or 400 errors
            if (
              error instanceof Error &&
              (error.message.includes("404") || error.message.includes("400"))
            ) {
              reject(error);
              return;
            }

            // Wait before retry (exponential backoff)
            if (attempt < this.retryAttempts) {
              const delay = this.retryDelayMs * Math.pow(2, attempt - 1);
              await this.sleep(delay);
            }
          }
        }

        // All retries failed
        reject(
          lastError ||
            new Error(`Request failed after ${this.retryAttempts} attempts`)
        );
      });

      // Start processing queue if not already running
      if (!this.isProcessingQueue) {
        this.processQueue();
      }
    });
  }

  /**
   * Process the request queue sequentially
   */
  private async processQueue(): Promise<void> {
    this.isProcessingQueue = true;

    while (this.requestQueue.length > 0) {
      const request = this.requestQueue.shift();
      if (request) {
        await request();
      }
    }

    this.isProcessingQueue = false;
  }

  /**
   * Cache management
   */
  private getFromCache<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    const now = Date.now();
    const age = (now - entry.timestamp) / 1000; // Convert to seconds

    if (age > entry.ttl) {
      this.cache.delete(key);
      return null;
    }

    return entry.data as T;
  }

  private setCache<T>(key: string, data: T, ttlSeconds: number): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl: ttlSeconds,
    });

    // Periodically clean old cache entries (every 100 sets)
    if (this.cache.size > 1000 && Math.random() < 0.01) {
      this.cleanCache();
    }
  }

  private cleanCache(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      const age = (now - entry.timestamp) / 1000;
      if (age > entry.ttl) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Clear all cached data
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Utility: Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get cache statistics (useful for monitoring)
   */
  getCacheStats(): {
    size: number;
    entries: number;
    oldestEntry: number | null;
  } {
    let oldestTimestamp: number | null = null;

    for (const entry of this.cache.values()) {
      if (oldestTimestamp === null || entry.timestamp < oldestTimestamp) {
        oldestTimestamp = entry.timestamp;
      }
    }

    return {
      size: this.cache.size,
      entries: this.cache.size,
      oldestEntry: oldestTimestamp
        ? (Date.now() - oldestTimestamp) / 1000
        : null,
    };
  }
}
