/**
 * HTML Sanitization Utility
 *
 * Sanitizes HTML content from Azure DevOps comments using regex-based approach.
 * Works in Node.js environment (VS Code extension).
 */

/**
 * Sanitization profiles: "strict" for user comments, "markdown" for rendered markdown output.
 * Two separate sets prevent expanding the comment attack surface when allowing markdown tags.
 */
type SanitizeProfile = "strict" | "markdown";

const STRICT_TAGS = new Set(["span", "b", "strong", "i", "em", "a", "p", "br", "code", "pre"]);

const MARKDOWN_TAGS = new Set([
	...STRICT_TAGS,
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
	"ul",
	"ol",
	"li",
	"blockquote",
	"hr",
	"table",
	"thead",
	"tbody",
	"tr",
	"td",
	"th",
	"del",
	"div",
	"img",
]);

/**
 * Allowed URL schemes for href attributes
 */
const ALLOWED_URL_SCHEMES = ["http:", "https:", "mailto:"];

/**
 * Dangerous URL schemes to block (case-insensitive, handles entity encoding)
 */
const DANGEROUS_SCHEMES = ["javascript", "data", "vbscript", "file"];

/**
 * Sanitizes HTML content by allowing only safe tags and attributes.
 *
 * @param html - HTML string to sanitize (can be null or undefined)
 * @param profile - "strict" for user comments (default), "markdown" for rendered markdown output
 * @returns Sanitized HTML string (empty string if input is null/undefined)
 */
export function sanitizeHtml(
	html: string | null | undefined,
	profile: SanitizeProfile = "strict",
): string {
	if (html == null || html === "") {
		return "";
	}

	const allowedTags = profile === "markdown" ? MARKDOWN_TAGS : STRICT_TAGS;
	let result = html;

	// First, find all tags and process them
	result = result.replace(/<\/?([a-z][a-z0-9]*)\b[^>]*>/gi, (match, tagName) => {
		const tag = tagName.toLowerCase();

		if (!allowedTags.has(tag)) {
			// Remove disallowed tags entirely
			return "";
		}

		// For allowed tags, sanitize attributes
		if (tag === "a") {
			return sanitizeAnchorTag(match);
		}

		// img tags - only allow src (with URL validation), alt, title
		if (tag === "img") {
			return sanitizeImgTag(match);
		}

		// For span, code, pre - only allow class attribute
		if (tag === "span" || tag === "code" || tag === "pre") {
			return sanitizeTagWithClass(match, tag);
		}

		// Self-closing tags (br, hr)
		if (tag === "br" || tag === "hr") {
			return `<${tag}>`;
		}

		// Other allowed tags - strip all attributes
		const isClosing = match.startsWith("</");
		return isClosing ? `</${tag}>` : `<${tag}>`;
	});

	// Remove any remaining dangerous patterns
	result = result.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");

	return result;
}

/**
 * Sanitize anchor tags - allow href, title, target; add rel for security
 */
function sanitizeAnchorTag(match: string): string {
	const isClosing = match.startsWith("</");
	if (isClosing) {
		return "</a>";
	}

	// Extract href (quoted OR unquoted)
	const hrefMatch = match.match(/href\s*=\s*(?:["']([^"']*)["']|([^\s>]+))/i);
	const href = hrefMatch ? hrefMatch[1] || hrefMatch[2] : null;

	// Extract title
	const titleMatch = match.match(/title\s*=\s*["']([^"']*)["']/i);
	const title = titleMatch ? titleMatch[1] : null;

	// Extract target
	const targetMatch = match.match(/target\s*=\s*["']([^"']*)["']/i);
	const target = targetMatch ? targetMatch[1] : null;

	// Build sanitized tag
	let sanitized = "<a";

	if (href && isAllowedUrl(href)) {
		sanitized += ` href="${escapeAttribute(href)}"`;
	}

	if (title) {
		sanitized += ` title="${escapeAttribute(title)}"`;
	}

	if (target === "_blank") {
		sanitized += ' target="_blank" rel="noopener noreferrer"';
	}

	sanitized += ">";
	return sanitized;
}

/**
 * Sanitize img tags - allow src (with URL validation), alt, and title only
 */
function sanitizeImgTag(match: string): string {
	const isClosing = match.startsWith("</");
	if (isClosing) {
		return "";
	}

	const srcMatch = match.match(/src\s*=\s*(?:["']([^"']*)["']|([^\s>]+))/i);
	const src = srcMatch ? srcMatch[1] || srcMatch[2] : null;

	if (!src || !isAllowedUrl(src)) {
		return "";
	}

	const altMatch = match.match(/alt\s*=\s*["']([^"']*)["']/i);
	const alt = altMatch ? altMatch[1] : "";

	const titleMatch = match.match(/title\s*=\s*["']([^"']*)["']/i);
	const title = titleMatch ? titleMatch[1] : null;

	let sanitized = `<img src="${escapeAttribute(src)}" alt="${escapeAttribute(alt)}"`;
	if (title) {
		sanitized += ` title="${escapeAttribute(title)}"`;
	}
	sanitized += ">";
	return sanitized;
}

/**
 * Sanitize tags that only allow class attribute
 */
function sanitizeTagWithClass(match: string, tag: string): string {
	const isClosing = match.startsWith("</");
	if (isClosing) {
		return `</${tag}>`;
	}

	// Extract class
	const classMatch = match.match(/class\s*=\s*["']([^"']*)["']/i);
	const className = classMatch ? classMatch[1] : null;

	if (className) {
		return `<${tag} class="${escapeAttribute(className)}">`;
	}
	return `<${tag}>`;
}

/**
 * Check if a URL is safe (allowed scheme or relative URL)
 */
function isAllowedUrl(url: string): boolean {
	if (!url) {
		return false;
	}

	// Decode ALL HTML entities to catch bypass attempts
	const normalized = url
		// Hex numeric entities (&#x6a; or &#X6A;)
		.replace(/&#x([0-9a-fA-F]+);?/gi, (_, hex) => {
			try {
				return String.fromCharCode(parseInt(hex, 16));
			} catch {
				return "";
			}
		})
		// Decimal numeric entities (&#106;)
		.replace(/&#(\d+);?/gi, (_, dec) => {
			try {
				return String.fromCharCode(parseInt(dec, 10));
			} catch {
				return "";
			}
		})
		// Named whitespace entities that could obfuscate schemes
		.replace(/&(Tab|NewLine|nbsp);/gi, "")
		// Remove ALL whitespace and control characters (spaces, tabs, newlines, etc.)
		.replace(/\s+/g, "")
		// Also remove non-breaking space
		.replace(/\u00A0/g, "")
		.toLowerCase();

	// Block dangerous schemes
	for (const scheme of DANGEROUS_SCHEMES) {
		if (normalized.startsWith(`${scheme}:`)) {
			return false;
		}
	}

	// Relative URLs are allowed
	if (url.startsWith("/") || url.startsWith("./") || url.startsWith("../")) {
		return true;
	}

	// Check scheme allowlist on original URL (after decoding above)
	const schemeMatch = url.match(/^([a-z][a-z0-9+.-]*:)/i);
	if (!schemeMatch) {
		// No scheme = relative URL, allowed
		return true;
	}

	const scheme = schemeMatch[1].toLowerCase();
	return ALLOWED_URL_SCHEMES.includes(scheme);
}

/**
 * Escape characters for use in HTML attributes
 */
export function escapeAttribute(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#039;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

/**
 * Escapes HTML special characters to prevent HTML injection.
 * Use this for contexts where no HTML should be rendered.
 *
 * @param text - Text to escape (can be null or undefined)
 * @returns Escaped text (empty string if input is null/undefined)
 */
export function escapeHtml(text: string | null | undefined): string {
	if (text == null) {
		return "";
	}

	return text.replace(/[&<>"']/g, (char) => {
		const entities: Record<string, string> = {
			"&": "&amp;",
			"<": "&lt;",
			">": "&gt;",
			'"': "&quot;",
			"'": "&#039;",
		};
		return entities[char];
	});
}

/**
 * Convert plain text URLs to clickable links
 * Only converts URLs that are NOT already inside anchor tags
 *
 * @param html - HTML string that may contain plain text URLs
 * @returns HTML with URLs converted to clickable links
 */
export function autoLinkUrls(html: string): string {
	if (!html) return "";

	// Match URLs not already in href="..." or >...</a> contexts
	// This regex matches http/https URLs
	const urlPattern = /(?<!href=["']|>)(https?:\/\/[^\s<>"']+)/gi;

	return html.replace(urlPattern, (url) => {
		// Trim trailing punctuation that's likely not part of the URL
		let cleanUrl = url;
		const trailingPunctuation = /[.,;:!?)]+$/;
		const trailingMatch = cleanUrl.match(trailingPunctuation);
		let suffix = "";
		if (trailingMatch) {
			suffix = trailingMatch[0];
			cleanUrl = cleanUrl.slice(0, -suffix.length);
		}
		return `<a href="${escapeAttribute(cleanUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(cleanUrl)}</a>${suffix}`;
	});
}
