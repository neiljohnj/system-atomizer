import { Router, type Request } from "express";
import type { DatabaseSync } from "node:sqlite";
import { AuthService } from "./auth.js";
import { AcademicSetup } from "./academic-setup.js";
import { transaction } from "./account-activation.js";
import { HttpError } from "./errors.js";

export function academicRoutes(db: DatabaseSync, auth: AuthService, setup: AcademicSetup) {
  const router=Router();
  router.use((_request,response,next)=>{response.setHeader("cache-control","no-store"); next();});
  router.use((request,_response,next)=>{
    if (request.method !== "GET") {
      if (request.body === undefined) request.body = {};
      if (!request.body || typeof request.body !== "object" || Array.isArray(request.body)) throw new HttpError(400,"Send a JSON object");
    }
    next();
  });
  const actor=(request: Request)=>auth.session(request).currentUser;
  const param=(request: Request,key: string)=>String(request.params[key]);
  router.get("/",(q,s)=>s.json(setup.catalog(actor(q))));
  router.get("/offerings/:id",(q,s)=>s.json(setup.detail(actor(q),param(q,"id"))));
  router.post("/offerings/:id/roster/preview",(q,s)=>s.json(setup.rosterPlan(actor(q),param(q,"id"),q.body)));
  router.post("/courses",(q,s)=>s.status(201).json(transaction(db,()=>setup.createCourse(actor(q),q.body))));
  router.post("/terms",(q,s)=>s.status(201).json(transaction(db,()=>setup.createTerm(actor(q),q.body))));
  router.post("/offerings",(q,s)=>s.status(201).json(transaction(db,()=>setup.createOffering(actor(q),q.body))));
  router.patch("/offerings/:id/description",(q,s)=>s.json(transaction(db,()=>setup.describe(actor(q),param(q,"id"),q.body))));
  router.put("/offerings/:id/structure",(q,s)=>s.json(transaction(db,()=>setup.configure(actor(q),param(q,"id"),q.body))));
  router.post("/offerings/:id/managers",(q,s)=>s.json(transaction(db,()=>setup.grantManager(actor(q),param(q,"id"),q.body))));
  router.post("/faculty",(q,s)=>s.status(201).json(transaction(db,()=>setup.provisionFaculty(actor(q),q.body))));
  router.post("/accounts/:userId/activation",(q,s)=>s.json(transaction(db,()=>setup.handoff(actor(q),param(q,"userId"),q.body?.offeringId))));
  router.post("/accounts/:userId/revoke-sessions",(q,s)=>{transaction(db,()=>setup.revokeSessions(actor(q),param(q,"userId"))); s.status(204).end();});
  router.post("/offerings/:id/roster/apply",(q,s)=>s.json(transaction(db,()=>setup.applyRoster(actor(q),param(q,"id"),q.body))));
  router.put("/offerings/:id/enrollments/:enrollmentId",(q,s)=>s.json(transaction(db,()=>setup.placement(actor(q),param(q,"id"),param(q,"enrollmentId"),q.body))));
  router.post("/offerings/:id/ready",(q,s)=>s.json(transaction(db,()=>setup.ready(actor(q),param(q,"id"),q.body))));
  return router;
}
