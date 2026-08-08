import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { verifyClientToken } from "./client.service.js";
import { env } from "../../config/index.js";
import { prisma } from "../../db.js";

const BEARER = "Bearer ";

/**
 * Различаем причины 401 для более точной диагностики и плавного auto-retry с refresh token:
 *   - "missing_token"  — заголовок отсутствует (клиент не авторизован)
 *   - "invalid_token"  — токен невалиден (не наш / битый)
 *   - "expired_token"  — access протух → клиент должен ОБЯЗАН вызвать /client/auth/refresh
 *   - "client_not_found" / "client_blocked" — пользователь удалён или заблокирован
 *
 * Без этого различения фронт не мог отличить «надо перелогиниться» от «надо сделать refresh»
 * и каждый 401 выкидывал клиента на экран входа — отсюда и массовые жалобы.
 */
function sendUnauthorized(res: Response, code: "missing_token" | "invalid_token" | "expired_token" | "client_not_found" | "client_blocked", message: string) {
  return res.status(401).json({ code, message });
}

export async function requireClientAuth(req: Request, res: Response, next: NextFunction) {
  const raw = req.headers.authorization;
  const token = typeof raw === "string" && raw.startsWith(BEARER) ? raw.slice(BEARER.length) : null;

  if (!token) {
    return sendUnauthorized(res, "missing_token", "Unauthorized");
  }

  let payload;
  try {
    payload = verifyClientToken(token);
    if (!payload) {
      // verifyClientToken swallows jwt-ошибки — пробуем декодировать заново чтобы отличить
      // expired от invalid. На 24h access это критично для auto-refresh во фронте.
      try {
        jwt.verify(token, env.JWT_SECRET);
        return sendUnauthorized(res, "invalid_token", "Invalid or expired token");
      } catch (e) {
        const isExpired = e instanceof jwt.TokenExpiredError;
        return sendUnauthorized(
          res,
          isExpired ? "expired_token" : "invalid_token",
          isExpired ? "Token expired" : "Invalid or expired token"
        );
      }
    }
  } catch {
    return sendUnauthorized(res, "invalid_token", "Invalid or expired token");
  }

  const client = await prisma.client.findUnique({ where: { id: payload.clientId } });
  if (!client) {
    return sendUnauthorized(res, "client_not_found", "Account not found");
  }
  if (client.isBlocked) {
    return sendUnauthorized(res, "client_blocked", "Account is blocked");
  }

  (req as Request & { clientId: string; client: typeof client }).clientId = client.id;
  (req as Request & { clientId: string; client: typeof client }).client = client;
  next();
}
