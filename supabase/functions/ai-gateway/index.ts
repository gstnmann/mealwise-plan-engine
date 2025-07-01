/**
 * AI Gateway Function
 * 
 * Secure gateway for all AI requests with validation, rate limiting,
 * cost tracking, and response caching. Provides a centralized point
 * for all Claude API interactions.
 */

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://esm.sh/zod@3";

// =============================================================================
// REQUEST VALIDATION SCHEMA
// =============================================================================

const AIRequestSchema = z.object({
  model: z.enum(['claude-3-5-sonnet-20241022', 'claude-3-haiku-20240307']).default('claude-3-5-sonnet-20241022'),
  prompt: z.string().min(1).max(50000),
  max_tokens: z.number().min(1).max(4000).default(1000),
  temperature: z.number().min(0).max(1).default(0.3),
  context: z.object({
    user_id: z.string().uuid(),
    operation: z.enum([
      'recipe_scoring',
      'meal_assembly', 
      'coherence_review',
      'mood_analysis',
      'plan_improvement',
      'general'
    ]),
    generation_id: z.string().uuid().optional(),
    cache_key: z.string().optional()
  }),
  enable_cache: z.boolean().default(true)
});

type AIRequest = z.infer<typeof AIRequestSchema>;

// =============================================================================
// RATE LIMITING
// =============================================================================

class RateLimiter {
  private requests = new Map<string, number[]>();
  private readonly windowMs = 60 * 60 * 1000; // 1 hour
  private readonly maxRequests = 100; // per hour per user

  isAllowed(userId: string): boolean {
    const now = Date.now();
    const userRequests = this.requests.get(userId) || [];
    
    // Clean old requests
    const validRequests = userRequests.filter(time => now - time < this.windowMs);
    
    if (validRequests.length >= this.maxRequests) {
      return false;
    }
    
    validRequests.push(now);
    this.requests.set(userId, validRequests);
    return true;
  }

  getRemainingRequests(userId: string): number {
    const now = Date.now();
    const userRequests = this.requests.get(userId) || [];
    const validRequests = userRequests.filter(time => now - time < this.windowMs);
    return Math.max(0, this.maxRequests - validRequests.length);
  }
}

// =============================================================================
// RESPONSE CACHE
// =============================================================================

class ResponseCache {
  private cache = new Map<string, { response: any; timestamp: number; cost_cents: number }>();
  private readonly ttlMs = 30 * 60 * 1000; // 30 minutes

  get(key: string): { response: any; cost_cents: number } | null {
    const cached = this.cache.get(key);
    if (!cached) return null;
    
    if (Date.now() - cached.timestamp > this.ttlMs) {
      this.cache.delete(key);
      return null;
    }
    
    return { response: cached.response, cost_cents: cached.cost_cents };
  }

  set(key: string, response: any, costCents: number): void {
    this.cache.set(key, {
      response,
      timestamp: Date.now(),
      cost_cents: costCents
    });
  }

  generateKey(prompt: string, model: string, temperature: number): string {
    // Create a hash-like key for caching
    const keyData = `${model}:${temperature}:${prompt}`;
    return btoa(keyData).slice(0, 32);
  }
}

// =============================================================================
// MAIN HANDLER
// =============================================================================

const rateLimiter = new RateLimiter();
const responseCache = new ResponseCache();

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      },
    });
  }

  if (req.method !== 'POST') {
    return createErrorResponse('Method not allowed', 405);
  }

  const startTime = Date.now();

  try {
    // Initialize Supabase client
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      {
        global: { 
          headers: { Authorization: req.headers.get("Authorization")! } 
        },
      }
    );

    // Authenticate user
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return createErrorResponse('Unauthorized', 401);
    }

    // Validate request body
    const rawBody = await req.text();
    let requestData: AIRequest;
    
    try {
      const parsedBody = JSON.parse(rawBody);
      requestData = AIRequestSchema.parse(parsedBody);
    } catch (validationError) {
      return createErrorResponse(`Invalid request: ${validationError.message}`, 422);
    }

    // Check rate limiting
    if (!rateLimiter.isAllowed(user.id)) {
      return createErrorResponse(
        `Rate limit exceeded. ${rateLimiter.getRemainingRequests(user.id)} requests remaining this hour.`,
        429
      );
    }

    // Check for cached response
    let cacheKey: string | null = null;
    if (requestData.enable_cache) {
      cacheKey = requestData.context.cache_key || 
                responseCache.generateKey(requestData.prompt, requestData.model, requestData.temperature);
      
      const cached = responseCache.get(cacheKey);
      if (cached) {
        console.log(`Cache hit for key: ${cacheKey}`);
        
        await logAIRequest(supabase, {
          user_id: user.id,
          operation: requestData.context.operation,
          generation_id: requestData.context.generation_id,
          model: requestData.model,
          tokens_used: 0, // Cached response
          cost_cents: 0,
          duration_ms: Date.now() - startTime,
          cached: true,
          success: true
        });

        return new Response(
          JSON.stringify({
            success: true,
            response: cached.response,
            tokens_used: 0,
            cost_cents: 0,
            model: requestData.model,
            cached: true,
            remaining_requests: rateLimiter.getRemainingRequests(user.id)
          }),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
            },
          }
        );
      }
    }

    // Sanitize prompt
    const sanitizedPrompt = sanitizePrompt(requestData.prompt);
    
    // Make Claude API request
    const claudeResult = await callClaudeAPI({
      model: requestData.model,
      prompt: sanitizedPrompt,
      max_tokens: requestData.max_tokens,
      temperature: requestData.temperature
    });

    if (!claudeResult.success) {
      await logAIRequest(supabase, {
        user_id: user.id,
        operation: requestData.context.operation,
        generation_id: requestData.context.generation_id,
        model: requestData.model,
        tokens_used: 0,
        cost_cents: 0,
        duration_ms: Date.now() - startTime,
        cached: false,
        success: false,
        error_message: claudeResult.error
      });

      return createErrorResponse(claudeResult.error!, 500);
    }

    // Cache successful response
    if (cacheKey && requestData.enable_cache) {
      responseCache.set(cacheKey, claudeResult.response, claudeResult.cost_cents!);
    }

    // Log successful request
    await logAIRequest(supabase, {
      user_id: user.id,
      operation: requestData.context.operation,
      generation_id: requestData.context.generation_id,
      model: requestData.model,
      tokens_used: claudeResult.tokens_used!,
      cost_cents: claudeResult.cost_cents!,
      duration_ms: Date.now() - startTime,
      cached: false,
      success: true
    });

    return new Response(
      JSON.stringify({
        success: true,
        response: claudeResult.response,
        tokens_used: claudeResult.tokens_used,
        cost_cents: claudeResult.cost_cents,
        model: requestData.model,
        cached: false,
        remaining_requests: rateLimiter.getRemainingRequests(user.id)
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );

  } catch (error) {
    console.error('AI Gateway error:', error);
    return createErrorResponse('Internal server error', 500);
  }
});

// =============================================================================
// CLAUDE API INTEGRATION
// =============================================================================

async function callClaudeAPI(params: {
  model: string;
  prompt: string;
  max_tokens: number;
  temperature: number;
}): Promise<{
  success: boolean;
  response?: string;
  tokens_used?: number;
  cost_cents?: number;
  error?: string;
}> {
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': Deno.env.get('ANTHROPIC_API_KEY')!,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: params.model,
        max_tokens: params.max_tokens,
        temperature: params.temperature,
        messages: [{
          role: 'user',
          content: params.prompt
        }]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      return {
        success: false,
        error: `Claude API error: ${response.status} ${errorText}`
      };
    }

    const data = await response.json();
    const responseText = data.content[0]?.text || '';
    const inputTokens = data.usage?.input_tokens || 0;
    const outputTokens = data.usage?.output_tokens || 0;
    const costCents = calculateCost(inputTokens, outputTokens);

    return {
      success: true,
      response: responseText,
      tokens_used: inputTokens + outputTokens,
      cost_cents: costCents
    };

  } catch (error) {
    return {
      success: false,
      error: `Claude API request failed: ${error.message}`
    };
  }
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

function sanitizePrompt(prompt: string): string {
  // Remove potential injection attempts
  const sanitized = prompt
    .replace(/[\x00-\x1F\x7F]/g, '') // Remove control characters
    .replace(/<script[^>]*>.*?<\/script>/gi, '') // Remove script tags
    .replace(/javascript:/gi, '') // Remove javascript: URLs
    .trim();
  
  // Limit length as additional safety
  return sanitized.slice(0, 50000);
}

function calculateCost(inputTokens: number, outputTokens: number): number {
  // Claude 3.5 Sonnet pricing (as of 2024)
  const inputCostPer1k = 0.003;  // $3 per 1M tokens
  const outputCostPer1k = 0.015; // $15 per 1M tokens
  
  const inputCost = (inputTokens / 1000) * inputCostPer1k;
  const outputCost = (outputTokens / 1000) * outputCostPer1k;
  
  return Math.round((inputCost + outputCost) * 100); // Return in cents
}

function createErrorResponse(message: string, status: number) {
  return new Response(
    JSON.stringify({ 
      success: false, 
      error: message,
      status 
    }),
    {
      status,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    }
  );
}

async function logAIRequest(supabase: any, data: {
  user_id: string;
  operation: string;
  generation_id?: string;
  model: string;
  tokens_used: number;
  cost_cents: number;
  duration_ms: number;
  cached: boolean;
  success: boolean;
  error_message?: string;
}) {
  try {
    const { error } = await supabase
      .from('ai_request_logs')
      .insert({
        user_id: data.user_id,
        operation: data.operation,
        generation_id: data.generation_id,
        model: data.model,
        tokens_used: data.tokens_used,
        cost_cents: data.cost_cents,
        duration_ms: data.duration_ms,
        cached: data.cached,
        success: data.success,
        error_message: data.error_message,
        created_at: new Date().toISOString()
      });

    if (error) {
      console.error('Failed to log AI request:', error);
    }
  } catch (error) {
    console.error('Error logging AI request:', error);
  }
}