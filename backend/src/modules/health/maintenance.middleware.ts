/**
 * Middleware для проверки режима технических работ
 * Если включен режим технических работ, блокирует запросы с сообщением
 */

import { Request, Response, NextFunction } from "express";
import { prisma } from "../../db.js";

export async function checkMaintenance(req: Request, res: Response, next: NextFunction) {
  try {
    // Пропускаем эндпоинты для проверки здоровья и технических работ
    if (req.path.startsWith("/api/health")) {
      return next();
    }
    
    // Пропускаем webhook эндпоинты
    if (req.path.startsWith("/api/webhooks")) {
      return next();
    }
    
    const maintenanceSetting = await prisma.systemSetting.findUnique({
      where: { key: "maintenance_mode" },
    });
    
    const maintenanceEnabled = maintenanceSetting?.value === "true";
    
    if (maintenanceEnabled) {
      const maintenanceMessage = await prisma.systemSetting.findUnique({
        where: { key: "maintenance_message" },
      });
      
      return res.status(503).json({
        maintenance: true,
        message: maintenanceMessage?.value || "Технические работы. Система временно недоступна.",
      });
    }
    
    next();
  } catch (e) {
    // Если ошибка при проверке, пропускаем запрос
    next();
  }
}
