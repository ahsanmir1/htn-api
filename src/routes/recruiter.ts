import { Router } from "express";
import { AppError } from "../errors/app-error.js";
import { updateProfile } from "../auth/recruiter-auth.js";
import { requireRecruiter } from "../middleware/recruiter-auth.js";
import prisma from "../prisma/client.js";
import { ApplicationStatus } from "@prisma/client";

const router = Router();
router.use(requireRecruiter);

function sendError(res: any, error: unknown) {
  if (error instanceof AppError) return res.status(error.statusCode).json({ success: false, code: error.code, message: error.message });
  console.error("Recruiter API failed:", error);
  return res.status(500).json({ success: false, message: "Internal server error" });
}

function isAdmin(role: string): boolean {
  return role === "RECRUITER_ADMIN" || role === "PLATFORM_ADMIN";
}

async function accessibleJobIds(user: { id: string; organizationId: string; role: string }): Promise<string[]> {
  if (isAdmin(user.role)) {
    const rows = await prisma.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM "Job" WHERE organization_id=$1`, user.organizationId);
    return rows.map(r => r.id);
  }
  const rows = await prisma.$queryRawUnsafe<{ id: string }[]>(`
    SELECT j.id FROM "Job" j JOIN recruiter_job_access a ON a.job_id=j.id
    WHERE a.recruiter_id=$1 AND j.organization_id=$2
  `, user.id, user.organizationId);
  return rows.map(r => r.id);
}

async function resolveAccessibleJob(user: any, jobId: string) {
  const ids = await accessibleJobIds(user);
  const rows = await prisma.$queryRawUnsafe<any[]>(`
    SELECT j.id, j.external_id AS "externalId", j.title, j.status, j.location,
           j.employment_type AS "employmentType", j.workplace_type AS "workplaceType",
           j.posted_at AS "postedAt", j.apply_url AS "applyUrl", j.description,
           j.requirements, j.responsibilities, j.preferred_qualifications AS "preferredQualifications",
           o.id AS "organizationId", o.name AS "organizationName"
    FROM "Job" j JOIN "Organization" o ON o.id=j.organization_id
    WHERE j.id = ANY($1::uuid[]) AND (j.id::text=$2 OR COALESCE(j.external_id,'')=$2)
    LIMIT 1
  `, ids, jobId);
  return rows[0] ?? null;
}

router.get("/dashboard", async (req, res) => {
  try {
    const user = req.recruiter!;
    const ids = await accessibleJobIds(user);
    const [jobs, applications, candidates, interviews] = await Promise.all([
      prisma.$queryRawUnsafe<{ count: bigint }[]>(`SELECT COUNT(*) count FROM "Job" WHERE id=ANY($1::uuid[]) AND status='ACTIVE'`, ids),
      prisma.$queryRawUnsafe<{ count: bigint }[]>(`SELECT COUNT(*) count FROM "Application" a WHERE a.job_id=ANY($1::uuid[])`, ids),
      prisma.$queryRawUnsafe<{ count: bigint }[]>(`SELECT COUNT(DISTINCT a.candidate_id) count FROM "Application" a WHERE a.job_id=ANY($1::uuid[])`, ids),
      prisma.$queryRawUnsafe<{ count: bigint }[]>(`SELECT COUNT(*) count FROM "Application" a WHERE a.job_id=ANY($1::uuid[]) AND a.status='INTERVIEW'`, ids),
    ]);
    return res.json({ success: true, data: {
      user,
      metrics: {
        activeJobs: Number(jobs[0]?.count ?? 0),
        applications: Number(applications[0]?.count ?? 0),
        candidates: Number(candidates[0]?.count ?? 0),
        interviews: Number(interviews[0]?.count ?? 0),
      },
    }});
  } catch (error) { return sendError(res, error); }
});

router.get("/profile", async (req, res) => res.json({ success: true, data: req.recruiter }));

router.patch("/profile", async (req, res) => {
  try { return res.json({ success: true, data: await updateProfile(req.recruiter!, req.body ?? {}) }); }
  catch (error) { return sendError(res, error); }
});

router.get("/jobs", async (req, res) => {
  try {
    const user = req.recruiter!;
    const ids = await accessibleJobIds(user);
    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
    const status = typeof req.query.status === "string" ? req.query.status : "";
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
    const offset = (page - 1) * limit;
    const jobs = await prisma.$queryRawUnsafe<any[]>(`
      SELECT j.id, j.external_id AS "externalId", j.title, j.status, j.location,
             j.country, j.city, j.employment_type AS "employmentType", j.workplace_type AS "workplaceType",
             j.remote, j.posted_at AS "postedAt", j.expires_at AS "expiresAt", j.apply_url AS "applyUrl",
             j.canonical_url AS "canonicalUrl", o.id AS "organizationId", o.name AS "organizationName",
             (SELECT COUNT(*)::int FROM "Application" a WHERE a.job_id=j.id) AS "applicationCount"
      FROM "Job" j JOIN "Organization" o ON o.id=j.organization_id
      WHERE j.id=ANY($1::uuid[])
        AND ($2='' OR j.title ILIKE '%'||$2||'%' OR j.location ILIKE '%'||$2||'%')
        AND ($3='' OR j.status::text=$3)
      ORDER BY j.posted_at DESC NULLS LAST, j.created_at DESC
      OFFSET $4 LIMIT $5
    `, ids, search, status, offset, limit);
    const total = await prisma.$queryRawUnsafe<{ count: bigint }[]>(`
      SELECT COUNT(*) count FROM "Job" j WHERE j.id=ANY($1::uuid[])
        AND ($2='' OR j.title ILIKE '%'||$2||'%' OR j.location ILIKE '%'||$2||'%')
        AND ($3='' OR j.status::text=$3)
    `, ids, search, status);
    const count = Number(total[0]?.count ?? 0);
    return res.json({ success: true, data: jobs, pagination: { page, limit, total: count, totalPages: Math.ceil(count/limit), hasMore: offset+jobs.length<count } });
  } catch (error) { return sendError(res, error); }
});

router.get("/jobs/:jobId", async (req, res) => {
  try {
    const job = await resolveAccessibleJob(req.recruiter!, req.params.jobId);
    if (!job) return res.status(404).json({ success: false, code: "JOB_NOT_FOUND", message: "Job not found" });
    return res.json({ success: true, data: job });
  } catch (error) { return sendError(res, error); }
});

router.get("/candidates", async (req, res) => {
  try {
    const user = req.recruiter!;
    const ids = await accessibleJobIds(user);
    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
    const offset = (page - 1) * limit;
    const candidates = await prisma.$queryRawUnsafe<any[]>(`
      SELECT DISTINCT ON (c.id) c.id, c.first_name AS "firstName", c.last_name AS "lastName",
             c.email, c.phone, c.current_title AS "currentTitle", c.location, c.country, c.city,
             c.years_experience AS "yearsExperience", c.linkedin_url AS "linkedinUrl", c.status,
             c.created_at AS "createdAt", c.updated_at AS "updatedAt"
      FROM "Candidate" c JOIN "Application" a ON a.candidate_id=c.id
      WHERE a.job_id=ANY($1::uuid[])
        AND ($2='' OR c.first_name ILIKE '%'||$2||'%' OR c.last_name ILIKE '%'||$2||'%' OR c.email ILIKE '%'||$2||'%' OR c.current_title ILIKE '%'||$2||'%')
      ORDER BY c.id, c.updated_at DESC
    `, ids, search);
    const sliced = candidates.slice(offset, offset + limit);
    const total = candidates.length;
    return res.json({ success: true, data: sliced, pagination: { page, limit, total, totalPages: Math.ceil(total/limit), hasMore: offset+sliced.length<total } });
  } catch (error) { return sendError(res, error); }
});

router.get("/submissions", async (req, res) => {
  try {
    const user = req.recruiter!;
    const ids = await accessibleJobIds(user);
    const status = typeof req.query.status === "string" && Object.values(ApplicationStatus).includes(req.query.status as ApplicationStatus) ? req.query.status : "";
    const jobId = typeof req.query.jobId === "string" ? req.query.jobId : "";
    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
    const rows = await prisma.$queryRawUnsafe<any[]>(`
      SELECT a.id, a.status, a.source, a.submitted_at AS "submittedAt", a.created_at AS "createdAt",
             c.id AS "candidateId", c.first_name AS "firstName", c.last_name AS "lastName", c.email,
             c.current_title AS "currentTitle", c.location, c.linkedin_url AS "linkedinUrl",
             j.id AS "jobId", j.external_id AS "jobExternalId", j.title AS "jobTitle", o.name AS "organizationName"
      FROM "Application" a JOIN "Candidate" c ON c.id=a.candidate_id JOIN "Job" j ON j.id=a.job_id
      JOIN "Organization" o ON o.id=j.organization_id
      WHERE j.id=ANY($1::uuid[])
        AND ($2='' OR a.status::text=$2)
        AND ($3='' OR j.id::text=$3 OR COALESCE(j.external_id,'')=$3)
        AND ($4='' OR c.first_name ILIKE '%'||$4||'%' OR c.last_name ILIKE '%'||$4||'%' OR c.email ILIKE '%'||$4||'%' OR j.title ILIKE '%'||$4||'%')
      ORDER BY COALESCE(a.submitted_at,a.created_at) DESC
      LIMIT 100
    `, ids, status, jobId, search);
    return res.json({ success: true, data: rows });
  } catch (error) { return sendError(res, error); }
});

router.post("/jobs/:jobId/access/:recruiterId", async (req, res) => {
  try {
    const user = req.recruiter!;
    if (!isAdmin(user.role)) throw new AppError("FORBIDDEN", "Only recruiter administrators can assign jobs", 403);
    const job = await resolveAccessibleJob(user, req.params.jobId);
    if (!job) throw new AppError("JOB_NOT_FOUND", "Job not found", 404);
    const target = await prisma.$queryRawUnsafe<{ id: string; organizationId: string }[]>(`SELECT id, organization_id AS "organizationId" FROM recruiter_users WHERE id=$1 LIMIT 1`, req.params.recruiterId);
    if (!target[0] || target[0].organizationId !== user.organizationId) throw new AppError("FORBIDDEN", "Recruiter is not in your organization", 403);
    await prisma.$executeRawUnsafe(`INSERT INTO recruiter_job_access (recruiter_id,job_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, target[0].id, job.id);
    return res.status(201).json({ success: true });
  } catch (error) { return sendError(res, error); }
});

router.delete("/jobs/:jobId/access/:recruiterId", async (req, res) => {
  try {
    const user = req.recruiter!;
    if (!isAdmin(user.role)) throw new AppError("FORBIDDEN", "Only recruiter administrators can change job assignments", 403);
    const job = await resolveAccessibleJob(user, req.params.jobId);
    if (!job) throw new AppError("JOB_NOT_FOUND", "Job not found", 404);
    await prisma.$executeRawUnsafe(`DELETE FROM recruiter_job_access WHERE recruiter_id=$1 AND job_id=$2`, req.params.recruiterId, job.id);
    return res.json({ success: true });
  } catch (error) { return sendError(res, error); }
});

export default router;
