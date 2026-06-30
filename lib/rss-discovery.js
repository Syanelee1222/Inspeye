// ═══════════════════════════════════════════════════
//  RSS Discovery Engine
//  Discovers RSS/Atom feeds from a given URL by:
//  1. Parsing <link> tags in <head>
//  2. Scanning <a> tags for RSS-like URLs
//  3. Optionally fetching suspected links to verify
// ═══════════════════════════════════════════════════

const https = require('https');
const http  = require('http');
const { URL } = require('url');

const RSS_MIME_TYPES = [
  'application/rss+xml',
  'application/atom+xml',
  'application/rdf+xml',
  'application/feed+json',
  'text/xml',
  'application/xml',
  'application/x.atom+xml',
  'application/x.rss+xml',
];

const RSS_URL_PATTERNS = [
  /\/feed[\/\?#]/i,
  /\/rss[\/\?#]/i,
  /\/atom[\/\?#]/i,
  /\/feed\.xml$/i,
  /\/rss\.xml$/i,
  /\/atom\.xml$/i,
  /\/feed\.json$/i,
  /\/index\.xml$/i,
  /\/index\.rss$/i,
  /\/index\.atom$/i,
  /\.rss$/i,
  /\.atom$/i,
  /\.xml$/i,
];

/**
 * Discover RSS feeds from a given URL.
 * Returns: Promise<Array<{ title: string, url: string }>>
 */
async function discoverRSS(pageUrl) {
  if (!pageUrl || typeof pageUrl !== 'string') {
    return [];
  }

  // Normalize URL
  if (!pageUrl.startsWith('http://') && !pageUrl.startsWith('https://')) {
    pageUrl = 'https://' + pageUrl;
  }

  let html;
  try {
    html = await fetchHTML(pageUrl);
  } catch (err) {
    console.warn('[rss-discovery] Failed to fetch page:', err.message);
    return [];
  }

  if (!html) return [];

  const results = [];
  const seen = new Set();

  // Strategy 1: Parse <link> tags in <head>
  const linkFeeds = parseLinkTags(html, pageUrl);
  for (const feed of linkFeeds) {
    const absoluteUrl = resolveURL(feed.url, pageUrl);
    if (absoluteUrl && !seen.has(absoluteUrl)) {
      seen.add(absoluteUrl);
      results.push({
        title: feed.title || 'RSS Feed',
        url:   absoluteUrl,
      });
    }
  }

  // Strategy 2: Scan <a> tags for RSS-like URLs
  const anchorFeeds = parseAnchorTags(html, pageUrl);
  for (const feed of anchorFeeds) {
    const absoluteUrl = resolveURL(feed.url, pageUrl);
    if (absoluteUrl && !seen.has(absoluteUrl)) {
      seen.add(absoluteUrl);
      // Verify by actually fetching the URL
      const verified = await verifyRSSFeed(absoluteUrl);
      if (verified) {
        results.push({
          title: feed.title || verified.title || 'RSS Feed',
          url:   absoluteUrl,
        });
      }
    }
  }

  return results;
}

/**
 * Fetch HTML content of a URL.
 * Respects redirects, has a timeout, and limits response size.
 */
function fetchHTML(url) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const client = parsed.protocol === 'https:' ? https : http;

    const options = {
      hostname: parsed.hostname,
      path:     parsed.pathname + parsed.search,
      method:   'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      timeout: 10000,
    };

    const req = client.request(options, (res) => {
      // Follow redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const redirectUrl = resolveURL(res.headers.location, url);
        return fetchHTML(redirectUrl).then(resolve).catch(reject);
      }

      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode}`));
      }

      // Limit response size to 2MB
      let data = '';
      let totalSize = 0;
      const maxSize = 2 * 1024 * 1024;

      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        totalSize += Buffer.byteLength(chunk);
        if (totalSize > maxSize) {
          req.destroy();
          resolve(data); // Return what we have
          return;
        }
        data += chunk;
      });
      res.on('end', () => resolve(data));
      res.on('error', reject);
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    req.on('error', reject);
    req.end();
  });
}

/**
 * Parse <link> tags with RSS MIME types from HTML.
 */
function parseLinkTags(html, baseUrl) {
  const results = [];

  // Match: <link rel="alternate" type="application/rss+xml" href="..." title="...">
  const linkRegex = /<link\s[^>]*?rel\s*=\s*["'](?:alternate|feed)["'][^>]*?type\s*=\s*["']([^"']*)["'][^>]*?href\s*=\s*["']([^"']*)["']/gi;
  // Also match reversed attribute order
  const linkRegex2 = /<link\s[^>]*?type\s*=\s*["']([^"']*)["'][^>]*?rel\s*=\s*["'](?:alternate|feed)["'][^>]*?href\s*=\s*["']([^"']*)["']/gi;
  // Also match simple <link rel="alternate" href="..." type="...">
  const linkRegex3 = /<link\s[^>]*?rel\s*=\s*["'](?:alternate|feed)["'][^>]*?href\s*=\s*["']([^"']*)["'][^>]*?type\s*=\s*["']([^"']*)["']/gi;

  const allRegexes = [linkRegex, linkRegex2, linkRegex3];

  for (const regex of allRegexes) {
    let match;
    // Reset lastIndex for global regex
    regex.lastIndex = 0;
    while ((match = regex.exec(html)) !== null) {
      let type, href, titleMatch;
      if (match.length === 3) {
        // Determine which group is which based on the regex
        if (regex === linkRegex || regex === linkRegex2) {
          type  = match[1];
          href = match[2];
        } else {
          href = match[1];
          type  = match[2];
        }
      }

      if (type && isRSSMimeType(type)) {
        titleMatch = match[0].match(/title\s*=\s*["']([^"']*)["']/i);
        const title = titleMatch ? titleMatch[1] : '';
        results.push({ url: href, title });
      }
    }
  }

  // Fallback: simpler regex to catch more formats
  const simpleRegex = /<link[^>]*?href\s*=\s*["']([^"']*)["'][^>]*?type\s*=\s*["']([^"']*rss[^"']*|[^"']*atom[^"']*|[^"']*xml[^"']*)["'][^>]*?>/gi;
  let match;
  simpleRegex.lastIndex = 0;
  while ((match = simpleRegex.exec(html)) !== null) {
    const href = match[1];
    const type = match[2];
    if (href && type && isRSSMimeType(type)) {
      const titleMatch = match[0].match(/title\s*=\s*["']([^"']*)["']/i);
      results.push({ url: href, title: titleMatch ? titleMatch[1] : '' });
    }
  }

  return results;
}

/**
 * Parse <a> tags for RSS-like URLs.
 */
function parseAnchorTags(html, baseUrl) {
  const results = [];

  // Match all <a> tags with href
  const anchorRegex = /<a\s[^>]*?href\s*=\s*["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;

  let match;
  anchorRegex.lastIndex = 0;
  while ((match = anchorRegex.exec(html)) !== null) {
    const href = match[1];
    const text = match[2].replace(/<[^>]*>/g, '').trim();

    if (!href || href.startsWith('#') || href.startsWith('javascript:')) continue;

    // Check if URL matches RSS patterns
    const isRSSLike = RSS_URL_PATTERNS.some(pattern => pattern.test(href)) ||
                      RSS_URL_PATTERNS.some(pattern => pattern.test(text)) ||
                      text.toLowerCase().includes('rss') ||
                      text.toLowerCase().includes('feed') ||
                      text.toLowerCase().includes('atom');

    if (isRSSLike) {
      results.push({ url: href, title: text || href });
    }
  }

  return results;
}

/**
 * Verify if a URL actually returns RSS/Atom content.
 */
async function verifyRSSFeed(url) {
  try {
    const content = await fetchHTML(url);
    if (!content) return false;

    // Quick check: does the content look like RSS/Atom?
    const trimmed = content.trim().toLowerCase();
    if (
      trimmed.includes('<rss') ||
      trimmed.includes('<feed') ||
      trimmed.includes('<rdf:RDF') ||
      trimmed.includes('<?xml') && (
        trimmed.includes('<channel') ||
        trimmed.includes('<entry') ||
        trimmed.includes('<item')
      )
    ) {
      // Try to extract title
      const titleMatch = content.match(/<title(?:\s[^>]*)?>([\s\S]*?)<\/title>/i);
      const title = titleMatch ? titleMatch[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim() : '';
      return { valid: true, title };
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Check if a MIME type is an RSS type.
 */
function isRSSMimeType(type) {
  if (!type) return false;
  const lower = type.toLowerCase().trim();
  return RSS_MIME_TYPES.some(t => lower.includes(t));
}

/**
 * Resolve a relative URL against a base URL.
 */
function resolveURL(url, base) {
  if (!url) return '';
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  try {
    return new URL(url, base).href;
  } catch {
    return '';
  }
}

module.exports = { discoverRSS };
