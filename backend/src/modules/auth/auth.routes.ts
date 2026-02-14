import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db.js";
import { env } from "../../config/index.js";
import {
  verifyPassword,
  signAccessToken,
  signRefreshToken,
  verifyToken,
  hashPassword,
} from "./auth.service.js";
import { requireAuth } from "./middleware.js";

export const authRouter = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

authRouter.post("/login", async (req, res) => {
  try {
    const body = loginSchema.safeParse(req.body);
    if (!body.success) {
      return res.status(400).json({ message: "Invalid input", errors: body.error.flatten() });
    }

    const admin = await prisma.admin.findUnique({ where: { email: body.data.email } });
    if (!admin) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const valid = await verifyPassword(body.data.password, admin.passwordHash);
    if (!valid) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const accessToken = signAccessToken(
      { adminId: admin.id, email: admin.email },
      env.JWT_SECRET,
      env.JWT_ACCESS_EXPIRES_IN
    );
    const refreshToken = signRefreshToken(
      { adminId: admin.id, email: admin.email },
      env.JWT_SECRET,
      env.JWT_REFRESH_EXPIRES_IN
    );

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);
    await prisma.refreshToken.create({
      data: { adminId: admin.id, token: refreshToken, expiresAt },
    });

    return res.json({
      accessToken,
      refreshToken,
      expiresIn: env.JWT_ACCESS_EXPIRES_IN,
      admin: {
        id: admin.id,
        email: admin.email,
        mustChangePassword: admin.mustChangePassword,
        role: admin.role,
      },
    });
  } catch (e) {
    console.error("Login error:", e);
    const msg = e instanceof Error ? e.message : String(e);
    return res.status(500).json({ message: "Internal server error", error: msg });
  }
});

const refreshSchema = z.object({ refreshToken: z.string().min(1) });

authRouter.post("/refresh", async (req, res) => {
  const body = refreshSchema.safeParse(req.body);
  if (!body.success) {
    return res.status(400).json({ message: "Invalid input" });
  }

  const payload = verifyToken(body.data.refreshToken, env.JWT_SECRET);
  if (!payload || payload.type !== "refresh") {
    return res.status(401).json({ message: "Invalid or expired refresh token" });
  }

  const stored = await prisma.refreshToken.findUnique({
    where: { token: body.data.refreshToken },
    include: { admin: true },
  });
  if (!stored || stored.expiresAt < new Date()) {
    if (stored) await prisma.refreshToken.delete({ where: { id: stored.id } }).catch(() => {});
    return res.status(401).json({ message: "Invalid or expired refresh token" });
  }

  const accessToken = signAccessToken(
    { adminId: stored.admin.id, email: stored.admin.email },
    env.JWT_SECRET,
    env.JWT_ACCESS_EXPIRES_IN
  );

  return res.json({
    accessToken,
    expiresIn: env.JWT_ACCESS_EXPIRES_IN,
    admin: {
      id: stored.admin.id,
      email: stored.admin.email,
      mustChangePassword: stored.admin.mustChangePassword,
      role: stored.admin.role,
    },
  });
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, "Min 8 characters"),
});

authRouter.post("/change-password", requireAuth, async (req, res) => {
  const adminId = (req as unknown as { adminId?: string }).adminId!;

  const body = changePasswordSchema.safeParse(req.body);
  if (!body.success) {
    return res.status(400).json({ message: "Invalid input", errors: body.error.flatten() });
  }

  const admin = await prisma.admin.findUnique({ where: { id: adminId } });
  if (!admin) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const valid = await verifyPassword(body.data.currentPassword, admin.passwordHash);
  if (!valid) {
    return res.status(400).json({ message: "Current password is incorrect" });
  }

  const passwordHash = await hashPassword(body.data.newPassword);
  const updated = await prisma.admin.update({
    where: { id: adminId },
    data: { passwordHash, mustChangePassword: false },
    select: { id: true, email: true, mustChangePassword: true, role: true },
  });

  return res.json({
    success: true,
    message: "Password changed",
    admin: {
      id: updated.id,
      email: updated.email,
      mustChangePassword: updated.mustChangePassword,
      role: updated.role,
    },
  });
});

authRouter.post("/logout", async (req, res) => {
  const token = req.body?.refreshToken;
  if (token) {
    await prisma.refreshToken.deleteMany({ where: { token } }).catch(() => {});
  }
  return res.json({ success: true });
});
