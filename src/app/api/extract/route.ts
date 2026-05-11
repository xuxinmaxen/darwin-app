/**
 * POST /api/extract
 *
 * Body: { statement: string, projectType?: ProjectType, projectBackground?: string }
 *
 * Calls Claude to turn a free-form statement into a structured Intent.
 * Does NOT persist — caller decides whether to write to DB.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { callLLMJSON } from '@/lib/llm';
import {
  buildExtractIntentSystem,
  buildExtractIntentUser,
  isValidExtractedIntent,
} from '@/lib/prompts/extract-intent';
import type { ExtractedIntent } from '@/lib/types';

const BodySchema = z.object({
  statement: z.string().min(1, 'statement cannot be empty').max(50_000),
  projectType: z.enum(['html', 'ppt', 'doc', 'design']).default('html'),
  projectBackground: z.string().max(4000).optional(),
});

export async function POST(req: NextRequest) {
  let body: z.infer<typeof BodySchema>;
  try {
    const raw = await req.json();
    body = BodySchema.parse(raw);
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: `Invalid request: ${
          err instanceof Error ? err.message : String(err)
        }`,
      },
      { status: 400 }
    );
  }

  try {
    const system = buildExtractIntentSystem({
      projectType: body.projectType,
      projectBackground: body.projectBackground,
    });
    const user = buildExtractIntentUser(body.statement);

    const extracted = await callLLMJSON<ExtractedIntent>({
      system,
      user,
      cacheSystem: true,
      maxTokens: 256,
      temperature: 0,
    });

    if (!isValidExtractedIntent(extracted)) {
      return NextResponse.json(
        {
          ok: false,
          error: 'Claude returned invalid Intent shape',
          raw: extracted,
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      ok: true,
      intent: {
        ...extracted,
        statement: body.statement,
      },
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
