import express from "express";
import cors from "cors";

import jobsRouter from "./routes/jobs.js";
import applicationsRouter from "./routes/applications.js";
import resumesRouter from "./routes/resumes.js";
import candidatesRouter from "./routes/candidates.js";
import discoveryRouter from "./routes/discovery.js";

const app = express();

app.use(cors());

app.use(
  express.json({
    limit: "20mb",
  }),
);

app.use("/api/jobs", jobsRouter);
app.use("/api/applications", applicationsRouter);
app.use("/api/resumes", resumesRouter);
app.use("/api/candidates", candidatesRouter);
app.use("/api/discovery", discoveryRouter);

export default app;
