CREATE TABLE "CompanyProfile" (
    "id" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "domain" TEXT,
    "logoUrl" TEXT,
    "logoDataUrl" TEXT,
    "logoSource" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyProfile_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "JobApplication"
ADD COLUMN "companyProfileId" TEXT,
ALTER COLUMN "role" DROP NOT NULL;

CREATE UNIQUE INDEX "CompanyProfile_normalizedName_key" ON "CompanyProfile"("normalizedName");
CREATE INDEX "JobApplication_companyProfileId_idx" ON "JobApplication"("companyProfileId");

ALTER TABLE "JobApplication"
ADD CONSTRAINT "JobApplication_companyProfileId_fkey"
FOREIGN KEY ("companyProfileId") REFERENCES "CompanyProfile"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
