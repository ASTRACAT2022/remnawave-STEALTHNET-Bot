/**
 * Health Check routes
 * Эндпоинты для проверки здоровья системы и управления техническими работами
 */

import { Router } from "express";
import { prisma } from "../../db.js";
import { getHealthStatus, isSystemAvailable } from "./health.service.js";
import { requireAuth } from "../auth/middleware.js";

const router = Router();

/**
 * GET /api/health
 * Публичный эндпоинт для проверки здоровья системы
 */
router.get("/", async (req, res) => {
  const health = getHealthStatus();
  const statusCode = health.remnaApiAvailable ? 200 : 503;
  res.status(statusCode).json(health);
});

/**
 * GET /api/health/status
 * Получить статус технических работ (для админки)
 */
router.get("/status", requireAuth, async (req, res) => {
  try {
    const maintenanceSetting = await prisma.systemSetting.findUnique({
      where: { key: "maintenance_mode" },
    });
    
    const maintenanceEnabled = maintenanceSetting?.value === "true";
    const maintenanceMessage = await prisma.systemSetting.findUnique({
      where: { key: "maintenance_message" },
    });
    
    const health = getHealthStatus();
    
    res.json({
      maintenanceEnabled,
      maintenanceMessage: maintenanceMessage?.value || "Технические работы. Система временно недоступна.",
      remnaApiAvailable: health.remnaApiAvailable,
      lastCheckAt: health.lastCheckAt,
    });
  } catch (e) {
    res.status(500).json({ error: "Failed to get maintenance status" });
  }
});

/**
 * POST /api/health/maintenance
 * Включить/выключить режим технических работ
 */
router.post("/maintenance", requireAuth, async (req, res) => {
  try {
    const { enabled, message } = req.body;
    
    if (typeof enabled !== "boolean") {
      return res.status(400).json({ error: "enabled must be a boolean" });
    }
    
    // Сохраняем флаг технических работ
    await prisma.systemSetting.upsert({
      where: { key: "maintenance_mode" },
      update: { value: String(enabled) },
      create: { key: "maintenance_mode", value: String(enabled) },
    });
    
    // Сохраняем сообщение о технических работах
    if (message && typeof message === "string") {
      await prisma.systemSetting.upsert({
        where: { key: "maintenance_message" },
        update: { value: message },
        create: { key: "maintenance_message", value: message },
      });
    }
    
    res.json({ 
      success: true, 
      maintenanceEnabled: enabled,
      maintenanceMessage: message || "Технические работы. Система временно недоступна.",
    });
  } catch (e) {
    res.status(500).json({ error: "Failed to update maintenance mode" });
  }
});

/**
 * GET /api/health/maintenance
 * Публичный эндпоинт для проверки режима технических работ
 */
router.get("/maintenance", async (req, res) => {
  try {
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
    
    res.json({ maintenance: false });
  } catch (e) {
    res.status(500).json({ error: "Failed to check maintenance status" });
  }
});

export default router;
