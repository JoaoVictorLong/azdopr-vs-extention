/**
 * Valid LFS pointer file content (3 lines exactly)
 */
export const mockLfsPointer = `version https://git-lfs.github.com/spec/v1
oid sha256:4d7a214614ab2935c943f9e0ff69d22ebbe7a2b7b4e3b0e3e6e5c7d2f1e8c9a0
size 12345678`;

/**
 * Another valid LFS pointer with different OID and size
 */
export const mockLfsPointer2 = `version https://git-lfs.github.com/spec/v1
oid sha256:abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890
size 9876543`;

/**
 * Invalid LFS pointer - wrong version
 */
export const invalidLfsPointerWrongVersion = `version https://git-lfs.github.com/spec/v2
oid sha256:4d7a214614ab2935c943f9e0ff69d22ebbe7a2b7b4e3b0e3e6e5c7d2f1e8c9a0
size 12345678`;

/**
 * Invalid LFS pointer - missing oid line
 */
export const invalidLfsPointerMissingOid = `version https://git-lfs.github.com/spec/v1
size 12345678`;

/**
 * Invalid LFS pointer - missing size line
 */
export const invalidLfsPointerMissingSize = `version https://git-lfs.github.com/spec/v1
oid sha256:4d7a214614ab2935c943f9e0ff69d22ebbe7a2b7b4e3b0e3e6e5c7d2f1e8c9a0`;

/**
 * Invalid LFS pointer - extra lines
 */
export const invalidLfsPointerExtraLines = `version https://git-lfs.github.com/spec/v1
oid sha256:4d7a214614ab2935c943f9e0ff69d22ebbe7a2b7b4e3b0e3e6e5c7d2f1e8c9a0
size 12345678
extra line`;

/**
 * Invalid LFS pointer - malformed oid
 */
export const invalidLfsPointerMalformedOid = `version https://git-lfs.github.com/spec/v1
not-an-oid
size 12345678`;

/**
 * Invalid LFS pointer - malformed size
 */
export const invalidLfsPointerMalformedSize = `version https://git-lfs.github.com/spec/v1
oid sha256:4d7a214614ab2935c943f9e0ff69d22ebbe7a2b7b4e3b0e3e6e5c7d2f1e8c9a0
size not-a-number`;

/**
 * Mock PDF file buffer (minimal valid PDF)
 */
export const mockPdfBuffer = Buffer.from(
	"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj 3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R/Resources<<>>>>endobj\nxref\n0 4\n0000000000 65535 f\n0000000009 00000 n\n0000000052 00000 n\n0000000101 00000 n\ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n189\n%%EOF",
	"utf-8",
);

/**
 * Mock PNG image buffer (PNG signature + minimal valid structure)
 */
export const mockPngBuffer = Buffer.from([
	// PNG signature
	0x89,
	0x50,
	0x4e,
	0x47,
	0x0d,
	0x0a,
	0x1a,
	0x0a,
	// IHDR chunk
	0x00,
	0x00,
	0x00,
	0x0d, // chunk length
	0x49,
	0x48,
	0x44,
	0x52, // "IHDR"
	0x00,
	0x00,
	0x00,
	0x01, // width: 1
	0x00,
	0x00,
	0x00,
	0x01, // height: 1
	0x08,
	0x06,
	0x00,
	0x00,
	0x00, // bit depth, color type, etc.
	0x1f,
	0x15,
	0xc4,
	0x89, // CRC
	// IEND chunk
	0x00,
	0x00,
	0x00,
	0x00, // chunk length
	0x49,
	0x45,
	0x4e,
	0x44, // "IEND"
	0xae,
	0x42,
	0x60,
	0x82, // CRC
]);

/**
 * Mock JPEG image buffer (JPEG signature + minimal structure)
 */
export const mockJpegBuffer = Buffer.from([
	0xff,
	0xd8,
	0xff,
	0xe0, // JPEG signature
	0x00,
	0x10, // length
	0x4a,
	0x46,
	0x49,
	0x46,
	0x00, // "JFIF"
	0x01,
	0x01,
	0x00,
	0x00,
	0x01,
	0x00,
	0x01,
	0x00,
	0x00,
	0xff,
	0xd9, // minimal JPEG
]);

/**
 * Mock binary file buffer (generic binary data)
 */
export const mockBinaryBuffer = Buffer.from([
	0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f,
]);

/**
 * Mock text file content
 */
export const mockTextFileContent = `# README

This is a sample README file for testing.

## Features
- Feature 1
- Feature 2

## Installation
\`\`\`bash
npm install
\`\`\`
`;

/**
 * Helper to create a mock LFS pointer with custom OID and size
 */
export function createLfsPointer(oid: string, size: number): string {
	return `version https://git-lfs.github.com/spec/v1
oid sha256:${oid}
size ${size}`;
}

/**
 * Parse OID from LFS pointer (for testing parser)
 */
export function getExpectedOid(lfsPointer: string): string | null {
	const match = lfsPointer.match(/oid sha256:([a-f0-9]{64})/);
	return match ? match[1] : null;
}

/**
 * Parse size from LFS pointer (for testing parser)
 */
export function getExpectedSize(lfsPointer: string): number | null {
	const match = lfsPointer.match(/size (\d+)/);
	return match ? Number.parseInt(match[1], 10) : null;
}
