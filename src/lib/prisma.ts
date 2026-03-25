import type { PrismaClient as PrismaClientType } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { createRequire } from "module";
import path from "path";

type PrismaClient = PrismaClientType;
type PrismaClientModule = typeof import("@prisma/client");

const runtimeRequire = createRequire(path.join(process.cwd(), "package.json"));

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function clearPrismaClientModuleCache() {
  for (const cacheKey of Object.keys(runtimeRequire.cache)) {
    if (
      cacheKey.includes(`${path.sep}@prisma${path.sep}client`) ||
      cacheKey.includes(`${path.sep}.prisma${path.sep}client`)
    ) {
      delete runtimeRequire.cache[cacheKey];
    }
  }
}

function loadPrismaClientModule(): PrismaClientModule {
  return runtimeRequire("@prisma/client") as PrismaClientModule;
}

function createPrismaClient(): PrismaClient {
  const adapter = new PrismaNeon({
    connectionString: process.env.DATABASE_URL!,
  });
  const { PrismaClient } = loadPrismaClientModule();

  return new PrismaClient({ adapter });
}

function isCompatiblePrismaClient(
  client: PrismaClient | undefined
): client is PrismaClient {
  return Boolean(
    client &&
      "jobApplication" in client &&
      "companyProfile" in client
  );
}

function ensurePrismaClient(): PrismaClient {
  if (isCompatiblePrismaClient(globalForPrisma.prisma)) {
    return globalForPrisma.prisma;
  }

  if (process.env.NODE_ENV !== "production") {
    clearPrismaClientModuleCache();
  }

  return createPrismaClient();
}

export const prisma = ensurePrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
