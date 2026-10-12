import type { JobDefinition } from "../queue";
import * as email from "./email";
import * as gates from "./gates";
import * as icp from "./icp";
import * as normalise from "./normalise";
import * as people from "./people";
import * as personalise from "./personalise";
import * as push from "./push";
import * as research from "./research";
import * as review from "./review";

export const jobDefinitions: JobDefinition[] = [
  { step: "normalise", schema: normalise.schema, handler: normalise.handleNormalise },
  { step: "gates", schema: gates.schema, handler: gates.handleGates },
  { step: "icp", schema: icp.schema, handler: icp.handleIcp },
  { step: "people", schema: people.schema, handler: people.handlePeople },
  { step: "email", schema: email.schema, handler: email.handleEmail },
  { step: "research", schema: research.schema, handler: research.handleResearch },
  { step: "personalise", schema: personalise.schema, handler: personalise.handlePersonalise },
  { step: "review", schema: review.schema, handler: review.handleReview },
  { step: "push", schema: push.schema, handler: push.handlePush },
] as JobDefinition[];
