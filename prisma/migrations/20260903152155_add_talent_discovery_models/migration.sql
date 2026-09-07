-- CreateEnum
CREATE TYPE "SearchProvider" AS ENUM ('GOOGLE', 'BING', 'SERPER', 'SERPAPI', 'OTHER');

-- CreateEnum
CREATE TYPE "DiscoverySearchStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "DiscoveryRunStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "DiscoveredProfileStatus" AS ENUM ('NEW', 'REVIEWED', 'IMPORTED', 'DUPLICATE', 'REJECTED');

-- CreateEnum
CREATE TYPE "ProfileSource" AS ENUM ('LINKEDIN', 'GITHUB', 'WEBSITE', 'OTHER');

-- CreateEnum
CREATE TYPE "CandidateSourceType" AS ENUM ('APPLICATION', 'LINKEDIN_XRAY', 'REFERRAL', 'MANUAL', 'IMPORT', 'API', 'OTHER');

-- CreateTable
CREATE TABLE "DiscoverySearch" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "roles" JSONB,
    "skills" JSONB,
    "locations" JSONB,
    "companies" JSONB,
    "status" "DiscoverySearchStatus" NOT NULL DEFAULT 'DRAFT',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiscoverySearch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscoverySearchRun" (
    "id" UUID NOT NULL,
    "searchId" UUID NOT NULL,
    "provider" "SearchProvider" NOT NULL,
    "status" "DiscoveryRunStatus" NOT NULL DEFAULT 'PENDING',
    "resultCount" INTEGER,
    "newProfiles" INTEGER,
    "duplicates" INTEGER,
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscoverySearchRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscoveredProfile" (
    "id" UUID NOT NULL,
    "searchRunId" UUID NOT NULL,
    "source" "ProfileSource" NOT NULL,
    "profileUrl" TEXT NOT NULL,
    "normalizedUrl" TEXT NOT NULL,
    "name" TEXT,
    "headline" TEXT,
    "location" TEXT,
    "snippet" TEXT,
    "status" "DiscoveredProfileStatus" NOT NULL DEFAULT 'NEW',
    "confidence" DOUBLE PRECISION,
    "rawData" JSONB,
    "metadata" JSONB,
    "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "candidateId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiscoveredProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CandidateSource" (
    "id" UUID NOT NULL,
    "candidateId" UUID NOT NULL,
    "type" "CandidateSourceType" NOT NULL,
    "sourceUrl" TEXT,
    "searchId" UUID,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CandidateSource_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DiscoverySearch_organizationId_idx" ON "DiscoverySearch"("organizationId");

-- CreateIndex
CREATE INDEX "DiscoverySearch_status_idx" ON "DiscoverySearch"("status");

-- CreateIndex
CREATE INDEX "DiscoverySearch_organizationId_status_idx" ON "DiscoverySearch"("organizationId", "status");

-- CreateIndex
CREATE INDEX "DiscoverySearchRun_searchId_idx" ON "DiscoverySearchRun"("searchId");

-- CreateIndex
CREATE INDEX "DiscoverySearchRun_status_idx" ON "DiscoverySearchRun"("status");

-- CreateIndex
CREATE INDEX "DiscoverySearchRun_provider_idx" ON "DiscoverySearchRun"("provider");

-- CreateIndex
CREATE INDEX "DiscoverySearchRun_searchId_status_idx" ON "DiscoverySearchRun"("searchId", "status");

-- CreateIndex
CREATE INDEX "DiscoveredProfile_normalizedUrl_idx" ON "DiscoveredProfile"("normalizedUrl");

-- CreateIndex
CREATE INDEX "DiscoveredProfile_searchRunId_idx" ON "DiscoveredProfile"("searchRunId");

-- CreateIndex
CREATE INDEX "DiscoveredProfile_searchRunId_status_idx" ON "DiscoveredProfile"("searchRunId", "status");

-- CreateIndex
CREATE INDEX "DiscoveredProfile_candidateId_idx" ON "DiscoveredProfile"("candidateId");

-- CreateIndex
CREATE INDEX "DiscoveredProfile_status_idx" ON "DiscoveredProfile"("status");

-- CreateIndex
CREATE INDEX "DiscoveredProfile_source_idx" ON "DiscoveredProfile"("source");

-- CreateIndex
CREATE UNIQUE INDEX "DiscoveredProfile_searchRunId_normalizedUrl_key" ON "DiscoveredProfile"("searchRunId", "normalizedUrl");

-- CreateIndex
CREATE INDEX "CandidateSource_candidateId_idx" ON "CandidateSource"("candidateId");

-- CreateIndex
CREATE INDEX "CandidateSource_type_idx" ON "CandidateSource"("type");

-- CreateIndex
CREATE INDEX "CandidateSource_searchId_idx" ON "CandidateSource"("searchId");

-- AddForeignKey
ALTER TABLE "DiscoverySearch" ADD CONSTRAINT "DiscoverySearch_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoverySearchRun" ADD CONSTRAINT "DiscoverySearchRun_searchId_fkey" FOREIGN KEY ("searchId") REFERENCES "DiscoverySearch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveredProfile" ADD CONSTRAINT "DiscoveredProfile_searchRunId_fkey" FOREIGN KEY ("searchRunId") REFERENCES "DiscoverySearchRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveredProfile" ADD CONSTRAINT "DiscoveredProfile_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateSource" ADD CONSTRAINT "CandidateSource_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateSource" ADD CONSTRAINT "CandidateSource_searchId_fkey" FOREIGN KEY ("searchId") REFERENCES "DiscoverySearch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
