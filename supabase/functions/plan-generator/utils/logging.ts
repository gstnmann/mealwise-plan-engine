/**
 * Logging Utilities for Plan Generation
 * 
 * Centralized logging for generation events, performance tracking,
 * and error handling.
 */

import type { GenerationStage } from "../../../../types/plan.ts";

export interface GenerationLogData {
  user_id: string;
  generation_id: string;
  status: 'started' | 'completed' | 'failed' | 'fallback';
  stage?: GenerationStage;
  duration_ms?: number;
  claude_requests?: number;
  claude_tokens_used?: number;
  claude_cost_cents?: number;
  retry_count?: number;
  error_message?: string;
  fallback_reason?: string;
  recipes_selected?: number;
  nutritional_accuracy?: {
    calories_deviation: number;
    protein_deviation: number;
    fat_deviation: number;
    carbohydrates_deviation: number;
  };
}

/**
 * Log a generation event to the database
 */
export async function logGenerationEvent(supabase: any, logData: GenerationLogData): Promise<void> {
  try {
    const insertData: any = {
      user_id: logData.user_id,
      generation_id: logData.generation_id,
      status: logData.status
    };

    // Add optional fields if present
    if (logData.stage) insertData.stage = logData.stage;
    if (logData.duration_ms !== undefined) {
      insertData.duration_ms = logData.duration_ms;
      insertData.completed_at = new Date().toISOString();
    }
    if (logData.claude_requests !== undefined) insertData.claude_requests = logData.claude_requests;
    if (logData.claude_tokens_used !== undefined) insertData.claude_tokens_used = logData.claude_tokens_used;
    if (logData.claude_cost_cents !== undefined) insertData.claude_cost_cents = logData.claude_cost_cents;
    if (logData.retry_count !== undefined) insertData.retry_count = logData.retry_count;
    if (logData.error_message) insertData.error_message = logData.error_message;
    if (logData.fallback_reason) insertData.fallback_reason = logData.fallback_reason;
    if (logData.recipes_selected !== undefined) insertData.recipes_selected = logData.recipes_selected;
    if (logData.nutritional_accuracy) insertData.nutritional_accuracy = logData.nutritional_accuracy;

    const { error } = await supabase
      .from('plan_generation_logs')
      .insert(insertData);

    if (error) {
      console.error('Failed to log generation event:', error);
      // Don't throw - logging failures shouldn't break generation
    }
  } catch (error) {
    console.error('Error in logGenerationEvent:', error);
    // Don't throw - logging failures shouldn't break generation
  }
}

/**
 * Log a failed plan for debugging and improvement
 */
export async function logFailedPlan(supabase: any, data: {
  user_id: string;
  generation_id: string;
  failure_stage: GenerationStage;
  failure_reason: string;
  user_blueprint: any;
  attempted_recipes?: any;
  validation_results?: any;
  prompt_used?: string;
  ai_response?: string;
}): Promise<void> {
  try {
    const { error } = await supabase
      .from('failed_plans')
      .insert({
        user_id: data.user_id,
        generation_id: data.generation_id,
        failure_stage: data.failure_stage,
        failure_reason: data.failure_reason,
        user_blueprint: data.user_blueprint,
        attempted_recipes: data.attempted_recipes,
        validation_results: data.validation_results,
        prompt_used: data.prompt_used,
        ai_response: data.ai_response,
        reviewed: false,
        resolved: false
      });

    if (error) {
      console.error('Failed to log failed plan:', error);
    }
  } catch (error) {
    console.error('Error in logFailedPlan:', error);
  }
}

/**
 * Calculate estimated cost based on token usage
 * Claude 3.5 Sonnet pricing (approximate)
 */
export function calculateClaudeCost(inputTokens: number, outputTokens: number): number {
  const inputCostPer1k = 0.003; // $3 per 1M tokens
  const outputCostPer1k = 0.015; // $15 per 1M tokens
  
  const inputCost = (inputTokens / 1000) * inputCostPer1k;
  const outputCost = (outputTokens / 1000) * outputCostPer1k;
  
  return Math.round((inputCost + outputCost) * 100); // Return in cents
}

/**
 * Performance monitoring helper
 */
export class PerformanceTimer {
  private startTime: number;
  private stages: { [stage: string]: { start: number; duration?: number } } = {};
  
  constructor() {
    this.startTime = Date.now();
  }
  
  startStage(stage: string): void {
    this.stages[stage] = { start: Date.now() };
  }
  
  endStage(stage: string): number {
    if (this.stages[stage]) {
      const duration = Date.now() - this.stages[stage].start;
      this.stages[stage].duration = duration;
      return duration;
    }
    return 0;
  }
  
  getTotalDuration(): number {
    return Date.now() - this.startTime;
  }
  
  getStageBreakdown(): { [stage: string]: number } {
    const breakdown: { [stage: string]: number } = {};
    Object.entries(this.stages).forEach(([stage, data]) => {
      if (data.duration !== undefined) {
        breakdown[stage] = data.duration;
      }
    });
    return breakdown;
  }
}

/**
 * Log performance metrics for analysis
 */
export async function logPerformanceMetrics(supabase: any, data: {
  generation_id: string;
  user_id: string;
  total_duration_ms: number;
  stage_breakdown: { [stage: string]: number };
  claude_requests: number;
  success_rate: number;
}): Promise<void> {
  try {
    // Store in a separate performance metrics table if needed
    console.log('Performance metrics for generation:', {
      generation_id: data.generation_id,
      total_duration: `${data.total_duration_ms}ms`,
      stages: data.stage_breakdown,
      claude_requests: data.claude_requests,
      success_rate: `${(data.success_rate * 100).toFixed(1)}%`
    });
    
    // Could also store in a dedicated performance_metrics table
    // for more detailed analysis
  } catch (error) {
    console.error('Error logging performance metrics:', error);
  }
}