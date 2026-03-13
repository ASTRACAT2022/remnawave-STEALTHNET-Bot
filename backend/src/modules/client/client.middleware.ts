import { Request, Response, NextFunction } from "express";
import { verifyClientToken } from "./client.service.js";
import { prisma } from "../../db.js";

const BEARER = "Bearer ";

export async function requireClientAuth(req: Request, res: Response, next: NextFunction) {
  const raw = req.headers.authorization;
  const token = typeof raw === "string" && raw.startsWith(BEARER) ? raw.slice(BEARER.length) : null;

  if (!token) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const payload = verifyClientToken(token);
  if (!payload) {
    return res.status(401).json({ message: "Invalid or expired token" });
  }

  const client = await prisma.client.findUnique({ where: { id: payload.clientId } });
  if (!client) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  if (client.isBlocked) {
    return res.status(403).json({
      message: "Account is blocked",
      isBlocked: true,
      blockReason: client.blockReason ?? null,
    });
  }

  (req as Request & { clientId: string; client: typeof client }).clientId = client.id;
  (req as Request & { clientId: string; client: typeof client }).client = client;
  next();
}
