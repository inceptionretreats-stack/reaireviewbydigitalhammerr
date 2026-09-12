import { NextResponse } from 'next/server';
import { PromptVersionError, parseGuidance, type PromptVersionFields } from '@ai-review/core';
import type { AiPromptVersion } from '@ai-review/db';
import type { PromptVersionDraftInput } from '@ai-review/contracts';
import { apiError } from '@/lib/api-error';

/** Wire shape for a prompt version — snake_case like the rest of the API, guidance parsed. */
export function toWire(row: AiPromptVersion) {
  return {
    id: row.id,
    version: row.version,
    status: row.status,
    model: row.model,
    reasoning_effort: row.reasoningEffort,
    max_output_tokens: row.maxOutputTokens,
    rollout_percent: row.rolloutPercent,
    system_prompt: row.systemPrompt,
    output_schema: row.outputSchema,
    guidance: parseGuidance(row.guidance),
    created_at: row.createdAt,
    activated_at: row.activatedAt,
  };
}

export function toFields(
  input: PromptVersionDraftInput,
  outputSchema: Record<string, unknown>,
): PromptVersionFields {
  return {
    version: input.version,
    model: input.model,
    reasoningEffort: input.reasoning_effort,
    maxOutputTokens: input.max_output_tokens,
    systemPrompt: input.system_prompt,
    guidance: parseGuidance(input.guidance),
    outputSchema,
  };
}

/** One place that turns the service's error codes into the API's. */
export function promptVersionErrorResponse(error: unknown): NextResponse | null {
  if (!(error instanceof PromptVersionError)) return null;
  switch (error.code) {
    case 'NOT_FOUND':
      return apiError('RESOURCE_NOT_FOUND', 'No such prompt version.');
    case 'NOT_A_DRAFT':
      return apiError(
        'VALIDATION_FAILED',
        'Only a draft can be edited. Clone it to a new draft first.',
      );
    case 'VERSION_TAKEN':
      return apiError('VALIDATION_FAILED', 'That version number is already used.', {
        details: { fields: ['version'] },
      });
    case 'ALREADY_ACTIVE':
      return apiError('VALIDATION_FAILED', 'That version is already the active one.');
    case 'IS_ACTIVE':
      return apiError('VALIDATION_FAILED', 'Activate another version before archiving this one.');
    case 'INVALID':
      return apiError('VALIDATION_FAILED', error.message);
  }
}
