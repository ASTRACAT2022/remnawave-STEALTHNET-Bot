/**
 * Health Checker сервис
 * Проверяет доступность Remna API и устанавливает флаг технических работ
 */

import { remnaGetSystemStats } from "../remna/remna.client.js";
import { prisma } from "../../db.js";

export interface HealthStatus {
  remnaApiAvailable: boolean;
  lastCheckAt: Date;
  error?: string;
}

let healthStatus: HealthStatus = {
  remnaApiAvailable: true,
  lastCheckAt: new Date(),
};

const HEALTH_CHECK_INTERVAL = 30000; // 30 секунд

/**
 * Проверяет доступность Remna API и автоматически включает режим технических работ при недоступности
 */
export async function checkRemnaApiHealth(): Promise<boolean> {
  try {
    const result = await remnaGetSystemStats();
    const isAvailable = !result.error && result.status < 500;
    
    healthStatus = {
      remnaApiAvailable: isAvailable,
      lastCheckAt: new Date(),
      error: result.error,
    };
    
    // Если Remna API недоступно, автоматически включаем режим технических работ
    if (!isAvailable) {
      await prisma.systemSetting.upsert({
        where: { key: "maintenance_mode" },
        update: { value: "true" },
        create: { key: "maintenance_mode", value: "true" },
      });
      
      await prisma.systemSetting.upsert({
        where: { key: "maintenance_message" },
        update: { value: "Remna API недоступен. Технические работы. Система временно недоступна." },
        create: { key: "maintenance_message", value: "Remna API недоступен. Технические работы. Система временно недоступна." },
      });
    }
    
    return isAvailable;
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    healthStatus = {
      remnaApiAvailable: false,
      lastCheckAt: new Date(),
      error,
    };
    
    // Автоматически включаем режим технических работ при ошибке
    try {
      await prisma.systemSetting.upsert({
        where: { key: "maintenance_mode" },
        update: { value: "true" },
        create: { key: "maintenance_mode", value: "true" },
      });
      
      await prisma.systemSetting.upsert({
        where: { key: "maintenance_message" },
        update: { value: "Ошибка соединения с Remna API. Технические работы. Система временно недоступна." },
        create: { key: "maintenance_message", value: "Ошибка соединения с Remna API. Технические работы. Система временно недоступна." },
      });
    } catch (dbError) {
      console.error("Failed to enable maintenance mode:", dbError);
    }
    
    return false;
  }
}

/**
 * Получает текущий статус здоровья системы
 */
export function getHealthStatus(): HealthStatus {
  return { ...healthStatus };
}

/**
 * Запускает периодическую проверку здоровья
 */
export function startHealthCheck(): void {
  checkRemnaApiHealth(); // Первая проверка сразу
  
  setInterval(async () => {
    await checkRemnaApiHealth();
  }, HEALTH_CHECK_INTERVAL);
}

/**
 * Проверяет, доступна ли система (не на технических работах)
 */
export function isSystemAvailable(): boolean {
  return healthStatus.remnaApiAvailable;
}
