export async function sourceTextFromUrl(url: string): Promise<string> {
  const parsed = new URL(url);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Only http and https source URLs are supported");
  }

  const response = await fetch(parsed, {
    headers: {
      "user-agent": "EU-Figma-Translation-App/0.1"
    }
  });
  if (!response.ok) {
    throw new Error(`Source URL failed: ${response.status}`);
  }

  const html = await response.text();
  return productTextFromHtml(html);
}

export function productTextFromHtml(html: string): string {
  const withoutScripts = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ");
  const lines: string[] = [];

  for (const pattern of [
    /<title[^>]*>([\s\S]*?)<\/title>/gi,
    /<meta[^>]+(?:name|property)=["'](?:description|og:title|og:description|product:brand|product:retailer_item_id)["'][^>]+content=["']([^"']+)["'][^>]*>/gi,
    /<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi,
    /<li[^>]*>([\s\S]*?)<\/li>/gi,
    /<th[^>]*>([\s\S]*?)<\/th>/gi,
    /<td[^>]*>([\s\S]*?)<\/td>/gi,
    /<p[^>]*>([\s\S]*?)<\/p>/gi,
    /<span[^>]*(?:class|data-testid)=["'][^"']*(?:feature|spec|product|title|accessor|bundle|included|name)[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi,
    /<div[^>]*(?:class|data-testid)=["'][^"']*(?:feature|spec|product|title|accessor|bundle|included|name)[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi
  ]) {
    for (const match of withoutScripts.matchAll(pattern)) {
      const text = cleanHtmlText(match[1] ?? "");
      if (isUsefulProductLine(text)) lines.push(text);
    }
  }

  for (const match of withoutScripts.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    const jsonText = cleanHtmlText(match[1] ?? "");
    if (jsonText) lines.push(`Structured product data: ${jsonText.slice(0, 4000)}`);
  }

  return [...new Set(lines)]
    .join("\n")
    .trim()
    .slice(0, 40000);
}

function cleanHtmlText(value: string): string {
  return decodeEntities(
    value
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function isUsefulProductLine(value: string): boolean {
  if (value.length < 3 || value.length > 220) return false;
  if (/^(add to cart|buy now|shop now|learn more|privacy|cookie|subscribe|login|cart)$/i.test(value)) return false;
  return /[A-Za-zÄÖÜäöüß0-9]/.test(value);
}
