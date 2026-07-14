import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import companiesRouter from "./companies";
import storageRouter from "./storage";
import profileRouter from "./profile";
import pinsRouter from "./pins";
import adminRouter from "./admin";
import locationRouter from "./location";
import geocodeRouter from "./geocode";
import inspectionsRouter from "./inspections";
import canvassingRouter from "./canvassing";
import activityRouter from "./activity";
import weatherRouter from "./weather";
import crmRouter from "./crm";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(companiesRouter);
router.use(storageRouter);
router.use(profileRouter);
router.use(pinsRouter);
router.use(adminRouter);
router.use(locationRouter);
router.use(geocodeRouter);
router.use(inspectionsRouter);
router.use(canvassingRouter);
router.use(activityRouter);
router.use(weatherRouter);
router.use(crmRouter);

export default router;
