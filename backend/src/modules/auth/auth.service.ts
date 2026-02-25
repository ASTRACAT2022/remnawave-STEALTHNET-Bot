import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "../../db.js";
import type { Env } from "../../config/env.js";

const SALT_ROUNDS = 12;

export interface TokenPayload {
  adminId: string;
  email: string;
  type: "access" | "refresh";
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function signAccessToken(payload: Omit<TokenPayload, "type">, secret: string, expiresIn: string): string {
  return jwt.sign({ ...payload, type: "access" }, secret, { expiresIn } as jwt.SignOptions);
}

export function signRefreshToken(payload: Omit<TokenPayload, "type">, secret: string, expiresIn: string): string {
  return jwt.sign({ ...payload, type: "refresh" }, secret, { expiresIn } as jwt.SignOptions);
}

export function verifyToken(token: string, secret: string): TokenPayload | null {
  try {
    const decoded = jwt.verify(token, secret) as TokenPayload;
    return decoded;
  } catch {
    return null;
  }
}

export async function createAdmin(email: string, password: string) {
  const passwordHash = await hashPassword(password);
  return prisma.admin.create({
    data: {
      email,
      passwordHash,
      mustChangePassword: true,
      role: "ADMIN",
    },
  });
}

export async function ensureFirstAdmin(env: Env) {
  const count = await prisma.admin.count();
  if (count > 0) return null;

  const email = process.env.INIT_ADMIN_EMAIL ?? "admin@stealthnet.local";
  const rawPassword = process.env.INIT_ADMIN_PASSWORD ?? generateRandomPassword();

  const admin = await createAdmin(email, rawPassword);

  if (!process.env.INIT_ADMIN_PASSWORD) {
    console.log("========================================");
    console.log("STEALTHNET 3.0 — первый админ создан");
    console.log("Email:", email);
    console.log("Пароль (сохраните и смените в админке):", rawPassword);
    console.log("========================================");
  }

  return admin;
}

function generateRandomPassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  let s = "";
  for (let i = 0; i < 16; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}
