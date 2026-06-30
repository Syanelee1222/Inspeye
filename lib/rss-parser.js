// ═══════════════════════════════════════════
//  RSS Parser — lightweight XML parser for RSS/Atom feeds
//  Fix: content:encoded extraction with flexible whitespace
//       extract first image from content:encoded HTML
// ═══════════════════════════════════════════

class RSSParser {
  /**
   * Parse RSS 2.0 or Atom feed XML into structured items
   */
  parse(xml) {
    // Detect feed type
    if (xml.includes('<feed') && xml.includes('xmlns')) {
      return this.parseAtom(xml);
    }
    return this.parseRSS(xml);
  }

  parseRSS(xml) {
    const items = [];

    // Extract channel info
    const channelTitle = this.firstMatch(xml, /<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/i);
    const channelLink = this.firstMatch(xml, /<link>(.*?)<\/link>/i);

    // Extract items
    const itemMatches = [...xml.matchAll(/<item[\s\S]*?<\/item>/gi)];

    for (const itemMatch of itemMatches) {
      const itemXml = itemMatch[0];

      const title = this.decodeEntities(
        this.firstMatch(itemXml, /<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/i) ||
        this.firstMatch(itemXml, /<title>([\s\S]*?)<\/title>/i) || ''
      );

      const link = this.firstMatch(itemXml, /<link>(.*?)<\/link>/i) ||
        this.firstMatch(itemXml, /<link[^>]*href="([^"]*)"[^>]*\/?>/i) || '';

      // ── FIX: content:encoded with flexible whitespace ──
      const contentEncoded = this.extractContentEncoded(itemXml);

      const description = this.decodeEntities(
        this.firstMatch(itemXml, /<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/i) ||
        this.firstMatch(itemXml, /<description>([\s\S]*?)<\/description>/i) || ''
      );

      const pubDate = this.firstMatch(itemXml, /<pubDate>(.*?)<\/pubDate>/i) ||
        this.firstMatch(itemXml, /<dc:date>(.*?)<\/dc:date>/i) ||
        this.firstMatch(itemXml, /<published>(.*?)<\/published>/i) || '';

      const author = this.firstMatch(itemXml, /<dc:creator><!\[CDATA\[(.*?)\]\]><\/dc:creator>/i) ||
        this.firstMatch(itemXml, /<dc:creator>(.*?)<\/dc:creator>/i) ||
        this.firstMatch(itemXml, /<author>(.*?)<\/author>/i) || '';

      const guid = this.firstMatch(itemXml, /<guid[^>]*>(.*?)<\/guid>/i) ||
        this.firstMatch(itemXml, /<id>(.*?)<\/id>/i) || link || title;

      // Extract image: pass both itemXml (to find <img> in content:encoded raw) and contentEncoded
      const image = this.extractImage(itemXml, contentEncoded || description, link);

      // Extract categories
      const catMatches1 = [...itemXml.matchAll(/<category><!\[CDATA\[(.*?)\]\]><\/category>/gi)];
      const catMatches2 = [...itemXml.matchAll(/<category>(.*?)<\/category>/gi)];
      const categories = [
        ...catMatches1.map(m => m[1]),
        ...catMatches2.map(m => m[1])
      ].map(c => c.trim()).filter(Boolean);

      items.push({
        guid: (guid || '').trim(),
        title: title.trim(),
        link: link.trim(),
        description: this.stripHtml(description).substring(0, 200),
        content: contentEncoded || description,
        image,
        pubDate: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
        author: author.trim() || channelTitle || '',
        source: channelTitle || '',
        categories
      });
    }

    return {
      title: channelTitle,
      link: channelLink,
      items
    };
  }

  /**
   * Extract content:encoded with flexible whitespace handling
   * Handles: <content:encoded>\n<![CDATA[...]]>\n</content:encoded>
   */
  extractContentEncoded(itemXml) {
    // Strategy 1: <content:encoded>...\n<![CDATA[...]]>\n...</content:encoded>
    // Use a two-step approach: find the tag, then extract CDATA
    const tagStart = itemXml.indexOf('<content:encoded');
    if (tagStart === -1) return '';

    const tagEnd = itemXml.indexOf('</content:encoded>', tagStart);
    if (tagEnd === -1) return '';

    const tagBlock = itemXml.substring(tagStart, tagEnd + '</content:encoded>'.length);

    // Try CDATA first
    const cdataMatch = tagBlock.match(/<!\[CDATA\[([\s\S]*?)\]\]>/i);
    if (cdataMatch) return cdataMatch[1];

    // No CDATA: extract content between tags
    const innerStart = tagBlock.indexOf('>') + 1;
    const innerEnd = tagBlock.lastIndexOf('</content:encoded>');
    if (innerStart < innerEnd) return tagBlock.substring(innerStart, innerEnd).trim();

    return '';
  }

  parseAtom(xml) {
    const items = [];

    const feedTitle = this.firstMatch(xml, /<title[^>]*>(.*?)<\/title>/i);

    const entryMatches = [...xml.matchAll(/<entry[\s\S]*?<\/entry>/gi)];

    for (const entryMatch of entryMatches) {
      const entryXml = entryMatch[0];

      const title = this.decodeEntities(
        this.firstMatch(entryXml, /<title[^>]*><!\[CDATA\[(.*?)\]\]><\/title>/i) ||
        this.firstMatch(entryXml, /<title[^>]*>(.*?)<\/title>/i) || ''
      );

      const link = this.firstMatch(entryXml, /<link[^>]*href="([^"]*)"[^>]*rel="alternate"[^>]*\/?>/i) ||
        this.firstMatch(entryXml, /<link[^>]*rel="alternate"[^>]*href="([^"]*)"[^>]*\/?>/i) ||
        this.firstMatch(entryXml, /<link[^>]*href="([^"]*)"[^>]*\/?>/i) || '';

      const content = this.decodeEntities(
        this.firstMatch(entryXml, /<content[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/content>/i) ||
        this.firstMatch(entryXml, /<content[^>]*>([\s\S]*?)<\/content>/i) ||
        this.firstMatch(entryXml, /<summary[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/summary>/i) ||
        this.firstMatch(entryXml, /<summary[^>]*>([\s\S]*?)<\/summary>/i) || ''
      );

      const pubDate = this.firstMatch(entryXml, /<published>(.*?)<\/published>/i) ||
        this.firstMatch(entryXml, /<updated>(.*?)<\/updated>/i) || '';

      const author = this.firstMatch(entryXml, /<name>(.*?)<\/name>/i) || '';

      const guid = this.firstMatch(entryXml, /<id>(.*?)<\/id>/i) || link || title;

      const image = this.extractImage(entryXml, content, link);

      items.push({
        guid: (guid || '').trim(),
        title: title.trim(),
        link: link.trim(),
        description: this.stripHtml(content).substring(0, 200),
        content,
        image,
        pubDate: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
        author: author.trim() || feedTitle || '',
        source: feedTitle || '',
        categories: []
      });
    }

    return {
      title: feedTitle,
      link: '',
      items
    };
  }

  /**
   * Extract first image URL from feed item
   * Priority:
   *   0. First <img src="..."> in itemXml (content:encoded raw HTML)
   *   1. media:content
   *   2. media:thumbnail
   *   3. enclosure with image type
   *   4. enclosure (any, if URL looks like image)
   *   5. First <img src="..."> in decoded content
   *   6. og:image meta in content
   */
  extractImage(itemXml, content, link) {
    // 0. FIRST: extract from itemXml raw (handles ArtStation etc. where content:encoded has <img>)
    // Search for <img in the itemXml, but only within content:encoded section
    // Simpler: just search itemXml for the first <img src="...">
    let m = itemXml.match(/<img[^>]+src=["']([^"'\s]+)["']/i);
    if (m && m[1].startsWith('http')) return this.resolveUrl(m[1], link);

    // 1. media:content
    m = itemXml.match(/<media:content[^>]*url=["']([^"']+)["'][^>]*>/i);
    if (m) return m[1];

    // 2. media:thumbnail
    m = itemXml.match(/<media:thumbnail[^>]*url=["']([^"']+)["'][^>]*>/i);
    if (m) return m[1];

    // 3. enclosure with image type
    m = itemXml.match(/<enclosure[^>]*url=["']([^"']+)["'][^>]*type=["']image[^"']*["'][^>]*>/i);
    if (m) return m[1];

    // 4. enclosure (any)
    m = itemXml.match(/<enclosure[^>]*url=["']([^"']+)["'][^>]*>/i);
    if (m && m[1].match(/\.(jpg|jpeg|png|gif|webp|svg)/i)) return m[1];

    // 5. First <img src="..."> in decoded content
    if (content) {
      m = content.match(/<img[^>]+src=["']([^"'\s]+)["']/i);
      if (m) return this.resolveUrl(m[1], link);
    }

    // 6. og:image meta in content
    if (content) {
      m = content.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
      if (m) return m[1];
    }

    return null;
  }

  resolveUrl(url, baseUrl) {
    if (!url) return null;
    if (url.startsWith('http://') || url.startsWith('https://')) return url;
    if (url.startsWith('//')) return 'https:' + url;
    if (url.startsWith('/') && baseUrl) {
      try {
        const base = new URL(baseUrl);
        return base.origin + url;
      } catch { return url; }
    }
    return url;
  }

  firstMatch(str, regex) {
    const match = str.match(regex);
    return match ? match[1] : null;
  }

  stripHtml(html) {
    if (!html) return '';
    return html
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  decodeEntities(str) {
    if (!str) return '';
    return str
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&#x27;/g, "'")
      .replace(/&apos;/g, "'");
  }
}

module.exports = { RSSParser };
