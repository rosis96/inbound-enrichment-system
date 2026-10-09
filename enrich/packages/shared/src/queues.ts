import { z } from "zod";

export const PIPELINE_STEPS = [
  "normalise",
  "gates",
  "icp",
  "people",
  "email",
  "research",
  "personalise",
  "review",
  "push",
] as const;

export type PipelineStep = (typeof PIPELINE_STEPS)[number];

export type QueueName = `lead.${PipelineStep}`;

export const queueName = (step: PipelineStep): QueueName => `lead.${step}`;

export const QUEUE_NAMES: readonly QueueName[] = PIPELINE_STEPS.map(queueName);

export const NormaliseJobData = z.object({
  rawEventId: z.uuid(),
  force: z.boolean().optional(),
});
export type NormaliseJobData = z.infer<typeof NormaliseJobData>;

export const LeadJobData = z.object({
  leadId: z.uuid(),
  force: z.boolean().optional(),
});
export type LeadJobData = z.infer<typeof LeadJobData>;

/** Retry policy for transient errors. Config errors are handled in-job and never thrown. */
export const QUEUE_RETRY = {
  retryLimit: 3,
  retryDelay: 5,
  retryBackoff: true,
  retryDelayMax: 300,
} as const;
