import { Router } from "express";
import { ApplicationService } from "../services/applications.service.js";
import { AppError } from "../errors/app-error.js";
import { ApplicationStatus } from "@prisma/client";
import { requireRecruiter } from "../middleware/recruiter-auth.js";
import { assertApplicationAccess, getAccessibleJobIds } from "../auth/recruiter-auth.js";

const router = Router();
const applicationService = new ApplicationService();
function sendError(res:any,error:unknown){if(error instanceof AppError)return res.status(error.statusCode).json({success:false,code:error.code,message:error.message});console.error("Applications API failed:",error);return res.status(500).json({success:false,message:"Internal server error"});}

router.get("/", requireRecruiter, async (req,res)=>{try{const status=typeof req.query.status==="string"&&Object.values(ApplicationStatus).includes(req.query.status as ApplicationStatus)?req.query.status as ApplicationStatus:undefined;const jobId=typeof req.query.jobId==="string"?req.query.jobId:undefined;const ids=await getAccessibleJobIds(req.recruiter!);const result=await applicationService.listApplications({jobId,jobIds:ids,status,search:typeof req.query.search==="string"?req.query.search.trim():undefined,page:typeof req.query.page==="string"?Number(req.query.page)||1:1,limit:typeof req.query.limit==="string"?Number(req.query.limit)||20:20});return res.json({success:true,data:result.applications,pagination:result.pagination});}catch(error){return sendError(res,error);}});
router.get("/:applicationId", requireRecruiter, async(req,res)=>{try{await assertApplicationAccess(req.recruiter!,req.params.applicationId);const application=await applicationService.getApplicationById(req.params.applicationId);if(!application)return res.status(404).json({success:false,code:"APPLICATION_NOT_FOUND",message:"Application not found"});return res.json({success:true,data:application});}catch(error){return sendError(res,error);}});
router.patch("/:applicationId", requireRecruiter, async(req,res)=>{try{await assertApplicationAccess(req.recruiter!,req.params.applicationId);const application=await applicationService.updateApplicationStatus(req.params.applicationId,req.body?.status);return res.json({success:true,data:application});}catch(error){return sendError(res,error);}});

// Public careers-site application submission remains unauthenticated.
router.post("/",async(req,res)=>{try{const application=await applicationService.createApplication(req.body??{});return res.status(201).json({success:true,data:application});}catch(error){return sendError(res,error);}});
export default router;
