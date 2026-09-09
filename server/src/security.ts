import {
  randomBytes,
  scrypt as nodeScrypt,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";

export interface PasswordParameters {
  algorithm: "scrypt";
  N: number;
  r: number;
  p: number;
  keyLength: number;
  maxmem: number;
}

export interface PasswordRecord {
  passwordHash: string;
  passwordSalt: string;
  passwordParams: string;
}

export const PASSWORD_PARAMETERS: PasswordParameters = {
  algorithm: "scrypt",
  N: 32_768,
  r: 8,
  p: 3,
  keyLength: 64,
  maxmem: 64 * 1024 * 1024,
};

export function validatePassword(password: unknown): string {
  if (typeof password !== "string" || password.length < 10 || password.length > 128) {
    throw new Error("Password must contain between 10 and 128 characters");
  }
  return password;
}

export function normalizeLoginIdentifier(identifier: string): string {
  return identifier.trim().toLocaleLowerCase("en-US");
}

export function createPasswordRecord(password: string): PasswordRecord {
  validatePassword(password);
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, PASSWORD_PARAMETERS.keyLength, PASSWORD_PARAMETERS);
  return {
    passwordHash: hash.toString("base64"),
    passwordSalt: salt.toString("base64"),
    passwordParams: JSON.stringify(PASSWORD_PARAMETERS),
  };
}

export async function verifyPassword(
  password: string,
  saltValue: string,
  hashValue: string,
  parametersValue: string,
): Promise<boolean> {
  const expected = Buffer.from(hashValue, "base64");
  const salt = Buffer.from(saltValue, "base64");
  const parameters = parsePasswordParameters(parametersValue, expected.length);
  const actual = await new Promise<Buffer>((resolve, reject) => {
    nodeScrypt(password, salt, parameters.keyLength, parameters, (error, derived) => {
      if (error) reject(error);
      else resolve(derived as Buffer);
    });
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function parsePasswordParameters(value: string, keyLength: number): PasswordParameters {
  try {
    const parsed = JSON.parse(value) as Partial<PasswordParameters>;
    if (parsed.algorithm !== "scrypt") throw new Error("Unsupported password algorithm");
    return {
      algorithm: "scrypt",
      N: Number(parsed.N),
      r: Number(parsed.r),
      p: Number(parsed.p),
      keyLength: Number(parsed.keyLength || keyLength),
      maxmem: Number(parsed.maxmem || PASSWORD_PARAMETERS.maxmem),
    };
  } catch {
    return { ...PASSWORD_PARAMETERS, keyLength };
  }
}
