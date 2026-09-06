import { CONFIG } from '../config';
import type {
  ClaimableFees,
  LaunchStatusResponse,
  PrepareClaimResponse,
  PrepareLaunchRequest,
  PrepareLaunchResponse,
  StonkLaunchLabPricing,
  StonkLaunchRecord,
  StonkPair,
  StonkToken,
  SubmitClaimResponse,
  SubmitLaunchRequest,
  SubmitLaunchResponse,
} from './types';

// StonkFun public API client: reads plus the launch and claim write flow.
// No API key. Retry rules live here so handlers never re-pay by accident:
//   429 -> wait Retry-After (capped) and retry once
//   409 on submit -> the payment already landed; caller re-runs prepare, never re-pays
//   503 with charged:false on submit -> nothing was charged; caller may retry from prepare
//   500 -> safe to retry once

export const STONKFUN_BASE_URL = 'https://www.stonkfun.xyz/api/public/v1';
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_RETRY_AFTER_MS = 5_000;
const USER_AGENT = 'StonkFlow/0.1 (+https://stonkflow.xyz)';

export class StonkFunError extends Error {
  readonly code: string;
  readonly status: number;
  readonly charged: boolean | undefined;
  constructor(status: number, code: string, message: string, charged?: boolean) {
    super(`stonkfun ${status} ${code}: ${message}`);
    this.name = 'StonkFunError';
    this.code = code;
    this.status = status;
    this.charged = charged;
  }
  get isConflict() {
    return this.status === 409;
  }
  get isUnchargedUnavailable() {
    return this.status === 503 && this.charged === false;
  }
}

type Envelope<T> = { data: T; meta?: { generatedAt?: string } };
type CacheEntry<T> = { value: T; expiry: number };

export class StonkFunClient {
  private readonly baseUrl: string;
  private readonly memory = new Map<string, CacheEntry<unknown>>();
  private readonly fetchImpl: typeof fetch;

  constructor(opts: { baseUrl?: string; fetchImpl?: typeof fetch } = {}) {
    this.baseUrl = opts.baseUrl ?? CONFIG.stonkfun.baseUrl ?? STONKFUN_BASE_URL;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  // --- reads ---------------------------------------------------------------

  /** All quote assets. Cached 60 s. Pass launchableOnly to ask StonkFun for launchable=true. */
  async getPairs(launchableOnly = true): Promise<StonkPair[]> {
    const key = `pairs:${launchableOnly}`;
    const cached = this.fromCache<StonkPair[]>(key);
    if (cached) return cached;
    const data = await this.request<{ pairs: StonkPair[] }>(`/pairs${launchableOnly ? '?launchable=true' : ''}`);
    const pairs = Array.isArray(data.pairs) ? data.pairs : [];
    this.toCache(key, pairs, 60_000);
    return pairs;
  }

  async getToken(mint: string): Promise<{ token: StonkToken; launch: StonkLaunchRecord | null } | null> {
    try {
      const data = await this.request<{ token: StonkToken; launch?: StonkLaunchRecord | null }>(`/tokens/${mint}`);
      return { token: data.token, launch: data.launch ?? null };
    } catch (err) {
      if (err instanceof StonkFunError && err.status === 404) return null;
      throw err;
    }
  }

  async getLaunchLabPricing(quoteMint: string): Promise<StonkLaunchLabPricing> {
    const key = `pricing:${quoteMint}`;
    const cached = this.fromCache<StonkLaunchLabPricing>(key);
    if (cached) return cached;
    const data = await this.request<StonkLaunchLabPricing>(`/launchlab/pricing?quoteMint=${encodeURIComponent(quoteMint)}`);
    this.toCache(key, data, 60_000);
    return data;
  }

  async getClaimableFees(mint: string): Promise<ClaimableFees> {
    return this.request<ClaimableFees>(`/tokens/${mint}/fees`);
  }

  // --- launch flow ---------------------------------------------------------

  /** Step 1: validate and get a signed quote plus an unsigned payment transaction. */
  async prepareLaunch(body: PrepareLaunchRequest): Promise<PrepareLaunchResponse> {
    return this.request<PrepareLaunchResponse>('/launches/prepare', { method: 'POST', body });
  }

  /** Step 2: submit the creator-signed payment. All-or-nothing Jito bundle. */
  async submitLaunch(body: SubmitLaunchRequest): Promise<SubmitLaunchResponse> {
    return this.request<SubmitLaunchResponse>('/launches/submit', { method: 'POST', body, timeoutMs: 60_000 });
  }

  /** Step 3: poll after "processing" until "completed". */
  async getLaunch(paymentSignature: string): Promise<LaunchStatusResponse> {
    return this.request<LaunchStatusResponse>(`/launches/${paymentSignature}`);
  }

  // --- claim flow ----------------------------------------------------------

  async prepareClaim(mint: string, creatorWallet: string): Promise<PrepareClaimResponse> {
    return this.request<PrepareClaimResponse>(`/tokens/${mint}/fees/claim/prepare`, { method: 'POST', body: { creatorWallet } });
  }

  async submitClaim(mint: string, body: { creatorWallet: string; intentId: string; signedTransaction: string }): Promise<SubmitClaimResponse> {
    return this.request<SubmitClaimResponse>(`/tokens/${mint}/fees/claim/submit`, { method: 'POST', body, timeoutMs: 60_000 });
  }

  // --- transport -----------------------------------------------------------

  private async request<T>(
    path: string,
    opts: { method?: 'GET' | 'POST'; body?: unknown; timeoutMs?: number; attempt?: number } = {},
  ): Promise<T> {
    const { method = 'GET', body, timeoutMs = DEFAULT_TIMEOUT_MS, attempt = 0 } = opts;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Accept: 'application/json',
          'User-Agent': USER_AGENT,
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      if (res.status === 429 && attempt === 0) {
        const retryAfter = Number(res.headers.get('retry-after') ?? '1');
        await drain(res);
        const waitMs = Math.min(Math.max(retryAfter, 0.5) * 1000, MAX_RETRY_AFTER_MS);
        await sleep(waitMs);
        return this.request<T>(path, { ...opts, attempt: 1 });
      }

      if (res.status === 500 && attempt === 0 && method === 'GET') {
        await drain(res);
        return this.request<T>(path, { ...opts, attempt: 1 });
      }

      if (!res.ok) {
        let code = 'http_error';
        let message = `HTTP ${res.status}`;
        let charged: boolean | undefined;
        try {
          const errBody = (await res.json()) as { error?: { code?: string; message?: string }; charged?: boolean; data?: { charged?: boolean } };
          code = errBody?.error?.code ?? code;
          message = errBody?.error?.message ?? message;
          charged = errBody?.charged ?? errBody?.data?.charged;
        } catch {
          await drain(res);
        }
        throw new StonkFunError(res.status, code, message, charged);
      }

      const json = (await res.json()) as Envelope<T>;
      if (!json || typeof json !== 'object' || !('data' in json)) {
        throw new StonkFunError(res.status, 'bad_envelope', `unexpected response shape for ${path}`);
      }
      return json.data;
    } finally {
      clearTimeout(timer);
    }
  }

  private fromCache<T>(key: string): T | null {
    const hit = this.memory.get(key);
    if (!hit) return null;
    if (hit.expiry < Date.now()) {
      this.memory.delete(key);
      return null;
    }
    return hit.value as T;
  }

  private toCache<T>(key: string, value: T, ttlMs: number) {
    this.memory.set(key, { value, expiry: Date.now() + ttlMs });
  }
}

async function drain(res: Response) {
  try {
    await res.text();
  } catch {
    /* bodyless */
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
