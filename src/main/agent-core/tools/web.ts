import { AgentTool } from '../types';
import { truncateText } from './shared';

const USER_AGENT = 'Nexa/1.0 (+https://nexa.local)';
const DEFAULT_TIMEOUT_MS = 30_000;

interface SearchResult {
  title: string;
  url: string;
  snippet?: string;
  source?: string;
}

interface OpenResult {
  url: string;
  finalUrl: string;
  status: number;
  contentType: string | null;
  title?: string;
  description?: string;
  publishedAt?: string;
  text: string;
  rawText?: string;
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x2F;/g, '/')
    .replace(/&#(\d+);/g, (_match, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCharCode(parseInt(code, 16)));
}

function stripTags(html: string): string {
  return decodeHtml(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|article|main|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function getFirstMatch(html: string, patterns: RegExp[]): string | undefined {
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return decodeHtml(match[1].trim());
  }
  return undefined;
}

function extractReadableText(html: string): {
  title?: string;
  description?: string;
  publishedAt?: string;
  text: string;
} {
  const title = getFirstMatch(html, [
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["'][^>]*>/i,
    /<title[^>]*>([\s\S]*?)<\/title>/i,
  ]);
  const description = getFirstMatch(html, [
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["'][^>]*>/i,
    /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["'][^>]*>/i,
  ]);
  const publishedAt = getFirstMatch(html, [
    /<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+name=["']date["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<time[^>]+datetime=["']([^"']+)["'][^>]*>/i,
  ]);

  const candidates = [
    html.match(/<article[\s\S]*?<\/article>/i)?.[0],
    html.match(/<main[\s\S]*?<\/main>/i)?.[0],
    html.match(/<body[\s\S]*?<\/body>/i)?.[0],
    html,
  ].filter(Boolean) as string[];

  let text = '';
  for (const candidate of candidates) {
    const current = stripTags(candidate);
    if (current.length > text.length) text = current;
    if (current.length > 1_500) break;
  }

  return { title, description, publishedAt, text: truncateText(text, 60_000) };
}

async function fetchWithTimeout(url: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/json,text/plain,*/*',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'User-Agent': USER_AGENT,
      },
      redirect: 'follow',
    });
  } finally {
    clearTimeout(timer);
  }
}

function normalizeUrl(url: string): string {
  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) throw new Error('Only http/https URLs are supported.');
  return trimmed;
}

async function openUrl(url: string, maxChars = 60_000): Promise<OpenResult> {
  const normalized = normalizeUrl(url);
  const response = await fetchWithTimeout(normalized);
  const contentType = response.headers.get('content-type');
  const raw = await response.text();

  if (!response.ok) {
    return {
      url: normalized,
      finalUrl: response.url,
      status: response.status,
      contentType,
      text: truncateText(raw || response.statusText, maxChars),
    };
  }

  if (contentType?.includes('application/json')) {
    return {
      url: normalized,
      finalUrl: response.url,
      status: response.status,
      contentType,
      text: truncateText(raw, maxChars),
      rawText: truncateText(raw, maxChars),
    };
  }

  if (!contentType || /html|xml/i.test(contentType)) {
    const extracted = extractReadableText(raw);
    return {
      url: normalized,
      finalUrl: response.url,
      status: response.status,
      contentType,
      ...extracted,
      text: truncateText(extracted.text, maxChars),
    };
  }

  return {
    url: normalized,
    finalUrl: response.url,
    status: response.status,
    contentType,
    text: truncateText(raw, maxChars),
    rawText: truncateText(raw, maxChars),
  };
}

async function openUrlWithBrowser(url: string, maxChars = 60_000): Promise<OpenResult & {
  renderer: string;
  javascriptExecuted: boolean;
  note?: string;
}> {
  const normalized = normalizeUrl(url);
  try {
    const electron = await import('electron');
    if (!electron.app?.isReady?.() || !electron.BrowserWindow) {
      throw new Error('Electron app is not ready.');
    }

    const win = new electron.BrowserWindow({
      show: false,
      width: 1280,
      height: 900,
      webPreferences: {
        sandbox: false,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Browser render timed out')), DEFAULT_TIMEOUT_MS);
        const cleanup = () => {
          clearTimeout(timeout);
          win.webContents.removeListener('did-finish-load', onFinish);
          win.webContents.removeListener('did-fail-load', onFail);
        };
        const onFinish = () => {
          cleanup();
          resolve();
        };
        const onFail = (_event: unknown, errorCode: number, errorDescription: string) => {
          cleanup();
          reject(new Error(`Browser load failed ${errorCode}: ${errorDescription}`));
        };
        win.webContents.once('did-finish-load', onFinish);
        win.webContents.once('did-fail-load', onFail);
        win.loadURL(normalized).catch(error => {
          cleanup();
          reject(error);
        });
      });

      await new Promise(resolve => setTimeout(resolve, 1_500));
      const page = await win.webContents.executeJavaScript(`
        (() => {
          const meta = (selector) => document.querySelector(selector)?.getAttribute('content') || '';
          const title = document.title || meta('meta[property="og:title"]') || '';
          const description = meta('meta[name="description"]') || meta('meta[property="og:description"]') || '';
          const publishedAt =
            meta('meta[property="article:published_time"]') ||
            meta('meta[name="date"]') ||
            document.querySelector('time[datetime]')?.getAttribute('datetime') ||
            '';
          const root = document.querySelector('article') || document.querySelector('main') || document.body;
          const text = root ? root.innerText : document.body.innerText;
          return { title, description, publishedAt, text, href: location.href };
        })();
      `, true) as { title?: string; description?: string; publishedAt?: string; text?: string; href?: string };

      return {
        url: normalized,
        finalUrl: page.href || win.webContents.getURL() || normalized,
        status: 200,
        contentType: 'text/html; rendered=electron',
        title: page.title?.trim() || undefined,
        description: page.description?.trim() || undefined,
        publishedAt: page.publishedAt?.trim() || undefined,
        text: truncateText(String(page.text || '').trim(), maxChars),
        renderer: 'electron-browser-window',
        javascriptExecuted: true,
      };
    } finally {
      if (!win.isDestroyed()) win.destroy();
    }
  } catch (error: any) {
    const fallback = await openUrl(normalized, maxChars);
    return {
      ...fallback,
      renderer: 'fetch-readability',
      javascriptExecuted: false,
      note: `Browser rendering unavailable, fell back to web_open: ${String(error?.message || error)}`,
    };
  }
}

function parseDuckDuckGo(html: string, limit: number): SearchResult[] {
  const results: SearchResult[] = [];
  const resultBlocks = html.matchAll(/<a[^>]+class=["'][^"']*result__a[^"']*["'][^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi);
  for (const match of resultBlocks) {
    let url = decodeHtml(match[1]);
    try {
      const parsed = new URL(url, 'https://duckduckgo.com');
      const uddg = parsed.searchParams.get('uddg');
      if (uddg) url = uddg;
    } catch { /* keep original */ }
    if (!/^https?:\/\//i.test(url)) continue;
    results.push({
      title: stripTags(match[2]),
      url,
      source: 'DuckDuckGo',
    });
    if (results.length >= limit) break;
  }
  return results;
}

function parseBing(html: string, limit: number): SearchResult[] {
  const results: SearchResult[] = [];
  const blocks = html.matchAll(/<li class=["']b_algo["'][\s\S]*?<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<p[^>]*>([\s\S]*?)<\/p>)?/gi);
  for (const match of blocks) {
    const url = decodeHtml(match[1]);
    if (!/^https?:\/\//i.test(url)) continue;
    results.push({
      title: stripTags(match[2]),
      url,
      snippet: match[3] ? stripTags(match[3]) : undefined,
      source: 'Bing',
    });
    if (results.length >= limit) break;
  }
  return results;
}

async function searchWeb(query: string, limit = 8): Promise<SearchResult[]> {
  const normalizedLimit = Math.max(1, Math.min(limit, 10));
  const duckUrl = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  try {
    const duck = await fetchWithTimeout(duckUrl);
    const html = await duck.text();
    const results = parseDuckDuckGo(html, normalizedLimit);
    if (results.length) return results;
  } catch { /* try fallback */ }

  const bingUrl = `https://www.bing.com/search?q=${encodeURIComponent(query)}`;
  const bing = await fetchWithTimeout(bingUrl);
  const html = await bing.text();
  return parseBing(html, normalizedLimit);
}

export const webSearchTool: AgentTool = {
  name: 'web_search',
  schema: {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search the public web for current information. Use this for latest, today, 2026/current events, prices, versions, laws, news, or when a URL is not known.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query.' },
          limit: { type: 'number', description: 'Maximum number of results, 1-10. Defaults to 8.' },
        },
        required: ['query'],
      },
    },
  },
  async run(args) {
    const query = String(args.query || '').trim();
    if (!query) throw new Error('query is required');
    const limit = Number(args.limit || 8);
    return { query, results: await searchWeb(query, limit) };
  },
};

export const webOpenTool: AgentTool = {
  name: 'web_open',
  schema: {
    type: 'function',
    function: {
      name: 'web_open',
      description: 'Open a public URL and extract readable text, title, description, and publication time when available. Prefer this over raw web_fetch for articles and docs.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'HTTP or HTTPS URL.' },
          maxChars: { type: 'number', description: 'Maximum text characters to return. Defaults to 60000.' },
        },
        required: ['url'],
      },
    },
  },
  async run(args) {
    return openUrl(String(args.url || ''), Math.max(1_000, Math.min(Number(args.maxChars || 60_000), 120_000)));
  },
};

export const browserOpenTool: AgentTool = {
  name: 'browser_open',
  schema: {
    type: 'function',
    function: {
      name: 'browser_open',
      description: 'Open a URL for pages that may require browser-style reading. Current implementation uses enhanced fetch/readability extraction and reports when JavaScript rendering may still be required.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'HTTP or HTTPS URL.' },
          maxChars: { type: 'number', description: 'Maximum text characters to return. Defaults to 60000.' },
        },
        required: ['url'],
      },
    },
  },
  async run(args) {
    return openUrlWithBrowser(
      String(args.url || ''),
      Math.max(1_000, Math.min(Number(args.maxChars || 60_000), 120_000)),
    );
  },
};

export const webResearchTool: AgentTool = {
  name: 'web_research',
  schema: {
    type: 'function',
    function: {
      name: 'web_research',
      description: 'Search the web, open top results, extract readable text, and return a compact multi-source research bundle. Use this for current facts requiring sources.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Research query.' },
          searchLimit: { type: 'number', description: 'Search result count, 1-10. Defaults to 6.' },
          openLimit: { type: 'number', description: 'Number of top results to open, 1-5. Defaults to 3.' },
          maxCharsPerPage: { type: 'number', description: 'Maximum extracted characters per opened page. Defaults to 12000.' },
        },
        required: ['query'],
      },
    },
  },
  async run(args) {
    const query = String(args.query || '').trim();
    if (!query) throw new Error('query is required');
    const searchLimit = Math.max(1, Math.min(Number(args.searchLimit || 6), 10));
    const openLimit = Math.max(1, Math.min(Number(args.openLimit || 3), 5));
    const maxCharsPerPage = Math.max(2_000, Math.min(Number(args.maxCharsPerPage || 12_000), 30_000));
    const results = await searchWeb(query, searchLimit);
    const pages = [];

    for (const result of results.slice(0, openLimit)) {
      try {
        const opened = await openUrl(result.url, maxCharsPerPage);
        pages.push({
          searchResult: result,
          ok: true,
          page: opened,
        });
      } catch (error: any) {
        pages.push({
          searchResult: result,
          ok: false,
          error: String(error?.message || error),
        });
      }
    }

    return {
      query,
      searchedAt: new Date().toISOString(),
      results,
      pages,
    };
  },
};

export const webFetchTool: AgentTool = {
  name: 'web_fetch',
  schema: {
    type: 'function',
    function: {
      name: 'web_fetch',
      description: 'Fetch a public HTTP/HTTPS URL and return raw-ish text content. Prefer web_open for readable pages and web_search/web_research when no URL is known.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'HTTP or HTTPS URL.' },
        },
        required: ['url'],
      },
    },
  },
  async run(args) {
    const url = normalizeUrl(String(args.url || ''));
    const response = await fetchWithTimeout(url);
    const text = await response.text();
    return {
      url,
      finalUrl: response.url,
      status: response.status,
      contentType: response.headers.get('content-type'),
      text: truncateText(text, 50_000),
    };
  },
};
