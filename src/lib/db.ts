import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";
import {
  DB_CONNECTION_TIMEOUT_MS,
  DB_IDLE_TIMEOUT_MS,
  DB_POOL_MAX,
  DB_TRANSACTION_MAX_WAIT_MS,
  DB_TRANSACTION_TIMEOUT_MS,
} from "@/lib/config";

function createPrismaClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Add it to .env (postgresql://postgres:postgres@localhost:5433/food_api?schema=public).",
    );
  }

  const adapter = new PrismaPg({
    connectionString,
    max: DB_POOL_MAX,
    connectionTimeoutMillis: DB_CONNECTION_TIMEOUT_MS,
    idleTimeoutMillis: DB_IDLE_TIMEOUT_MS,
  });

  return new PrismaClient({
    adapter,
    transactionOptions: {
      maxWait: DB_TRANSACTION_MAX_WAIT_MS,
      timeout: DB_TRANSACTION_TIMEOUT_MS,
    },
  });
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma: PrismaClient = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
