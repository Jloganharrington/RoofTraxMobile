ALTER TABLE "pins" ADD COLUMN "is_demo" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "pins" ADD COLUMN "needs_stage_review" boolean DEFAULT false NOT NULL;