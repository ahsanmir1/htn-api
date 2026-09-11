import { ApplicationSource } from "@prisma/client";
import { AppError } from "../errors/app-error.js";
import type { ApplicationWithRelations } from "../repositories/application.repository.js";
import type { CreateApplicationInput } from "./applications.service.js";

interface HtnAtsSubmissionJob {
  id: string;
  externalId: string | null;
  organizationId: string;
}

interface RecruiterIdentity {
  id: string;
  organizationId: string;
}

function getAtsBaseUrl(): string {
  const value = process.env.HTN_ATS_API_URL?.trim();
  if (!value) throw new AppError("INTEGRATION_NOT_CONFIGURED", "HTN ATS API URL is not configured", 503);
  return value.replace(/\/$/, "");
}

function getIntegrationKey(): string {
  const value = process.env.HTN_ATS_INTEGRATION_KEY?.trim();
  if (!value) throw new AppError("INTEGRATION_NOT_CONFIGURED", "ATS integration is not configured", 503);
  return value;
}

function clean(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function buildHtnAtsSubmissionPayload(
  application: ApplicationWithRelations,
  input: CreateApplicationInput,
  job: HtnAtsSubmissionJob,
  recruiter: RecruiterIdentity,
) {
  const resume = application.candidate.documents[0];
  const candidate = application.candidate;
  const payload: Record<string, unknown> = {
    htnCandidateId: candidate.id,
    htnSubmissionId: application.id,
    htnJobId: job.id,
    organization: {
      id: job.organizationId,
      htnId: recruiter.organizationId,
    },
    recruiter: { id: recruiter.id },
    candidate: {
      firstName: candidate.firstName,
      lastName: candidate.lastName,
      email: candidate.email,
    },
  };

  if (job.externalId) payload.atsJobId = job.externalId;

  const candidatePayload = payload.candidate as Record<string, unknown>;
  const optionalCandidateFields: Array<[string, unknown]> = [
    ["phone", candidate.phone],
    ["location", candidate.location],
    ["currentCompany", input.currentCompany],
    ["currentTitle", candidate.currentTitle],
    ["yearsExperience", candidate.yearsExperience],
    ["linkedInUrl", candidate.linkedinUrl],
    ["desiredSalary", application.salaryExpectation],
    ["additionalNotes", application.additionalNotes],
  ];
  for (const [key, value] of optionalCandidateFields) {
    if (typeof value === "number" ? Number.isFinite(value) : clean(value)) candidatePayload[key] = value;
  }

  if (resume) {
    payload.resume = {
      fileName: resume.fileName,
      mimeType: resume.mimeType,
      sizeBytes: resume.size,
      storageProvider: "CLOUDFLARE_R2",
      storageKey: resume.storageKey,
    };
  }

  return payload;
}

export async function syncHtnSubmissionToAts(
  application: ApplicationWithRelations,
  input: CreateApplicationInput,
  job: HtnAtsSubmissionJob,
  recruiter: RecruiterIdentity,
) {
  if (input.source !== ApplicationSource.RECRUITER) {
    throw new AppError("VALIDATION_ERROR", "HTN ATS sync requires recruiter source", 400);
  }

  const response = await fetch(`${getAtsBaseUrl()}/api/integrations/htn/submissions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getIntegrationKey()}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(buildHtnAtsSubmissionPayload(application, input, job, recruiter)),
  });

  const raw = await response.text();
  let body: any = null;
  try { body = raw ? JSON.parse(raw) : null; } catch { body = null; }

  if (!response.ok) {
    console.error("HTN to ATS submission sync failed", {
      status: response.status,
      candidateId: application.candidate.id,
      applicationId: application.id,
      jobId: job.id,
    });
    throw new AppError("ATS_SYNC_FAILED", `ATS submission sync failed (${response.status})`, 502);
  }

  if (!body?.success || !body?.candidateId || !body?.applicationId || !body?.jobId) {
    console.error("HTN to ATS submission sync returned invalid response", {
      candidateId: application.candidate.id,
      applicationId: application.id,
      jobId: job.id,
    });
    throw new AppError("ATS_SYNC_FAILED", "ATS returned an invalid submission response", 502);
  }

  return body as {
    success: true;
    candidateId: string;
    applicationId: string;
    jobId: string;
    candidate: "created" | "updated";
    application: "created" | "existing";
  };
}

export type { HtnAtsSubmissionJob, RecruiterIdentity };
