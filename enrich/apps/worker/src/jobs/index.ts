import type { WorkerContext } from "../context";
import { registerJob } from "../queue";
import * as email from "./email";
import * as gates from "./gates";
import * as icp from "./icp";
import * as normalise from "./normalise";
import * as people from "./people";
import * as personalise from "./personalise";
import * as push from "./push";
import * as research from "./research";
import * as review from "./review";

export async function registerAllJobs(ctx: WorkerContext): Promise<void> {
  await registerJob(ctx, { step: "normalise", schema: normalise.schema, handler: normalise.handleNormalise });
  await registerJob(ctx, { step: "gates", schema: gates.schema, handler: gates.handleGates });
  await registerJob(ctx, { step: "icp", schema: icp.schema, handler: icp.handleIcp });
  await registerJob(ctx, { step: "people", schema: people.schema, handler: people.handlePeople });
  await registerJob(ctx, { step: "email", schema: email.schema, handler: email.handleEmail });
  await registerJob(ctx, { step: "research", schema: research.schema, handler: research.handleResearch });
  await registerJob(ctx, { step: "personalise", schema: personalise.schema, handler: personalise.handlePersonalise });
  await registerJob(ctx, { step: "review", schema: review.schema, handler: review.handleReview });
  await registerJob(ctx, { step: "push", schema: push.schema, handler: push.handlePush });
}
