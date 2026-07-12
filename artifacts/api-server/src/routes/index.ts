import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import storageRouter from "./storage";
import profileRouter from "./profile";
import pinsRouter from "./pins";
import adminRouter from "./admin";
import locationRouter from "./location";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(storageRouter);
router.use(profileRouter);
router.use(pinsRouter);
router.use(adminRouter);
router.use(locationRouter);

export default router;
