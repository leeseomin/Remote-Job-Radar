const encoder = new TextEncoder();

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export async function sha256Bytes(value: string | Uint8Array): Promise<Uint8Array> {
  const input = typeof value === "string" ? encoder.encode(value) : value;
  return new Uint8Array(await crypto.subtle.digest("SHA-256", input));
}

export async function sha256Hex(value: string | Uint8Array): Promise<string> {
  return bytesToHex(await sha256Bytes(value));
}

export async function deterministicId(prefix: string, value: string): Promise<string> {
  return `${prefix}_${(await sha256Hex(value)).slice(0, 32)}`;
}

export function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  const length = Math.max(leftBytes.length, rightBytes.length);
  let difference = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return difference === 0;
}

export function canonicalSignatureInput(
  method: string,
  pathname: string,
  timestamp: string,
  nonce: string,
  bodyHash: string,
): string {
  return [method.toUpperCase(), pathname, timestamp, nonce, bodyHash].join("\n");
}

export async function verifyHmac(
  secret: string,
  canonical: string,
  signature: Uint8Array,
): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify("HMAC", key, signature, encoder.encode(canonical));
}
