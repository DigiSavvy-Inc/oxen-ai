function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function deriveKey(
  secret: string,
  usage: Array<"encrypt" | "decrypt">,
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: new TextEncoder().encode("oxen-studio-v1"),
      iterations: 100_000,
      hash: "SHA-256",
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    usage,
  );
}

export async function encryptSecret(
  plaintext: string,
  encryptionKey: string,
): Promise<{ ciphertext: string; iv: string }> {
  const key = await deriveKey(encryptionKey, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  return {
    ciphertext: bytesToBase64(new Uint8Array(encrypted)),
    iv: bytesToBase64(iv),
  };
}

export async function decryptSecret(
  ciphertext: string,
  iv: string,
  encryptionKey: string,
): Promise<string> {
  const key = await deriveKey(encryptionKey, ["decrypt"]);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(iv) },
    key,
    base64ToBytes(ciphertext),
  );
  return new TextDecoder().decode(decrypted);
}

export async function hmacSign(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload),
  );
  return bytesToBase64(new Uint8Array(signature));
}

export async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);
  if (aBytes.length !== bBytes.length) return false;
  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) diff |= aBytes[i]! ^ bBytes[i]!;
  return diff === 0;
}
