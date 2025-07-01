/**
 * Mealwise Plan Generation Engine - Main Entry Point
 * 
 * The core serverless function responsible for generating hyper-personalized,
 * validated, and engaging meal plans. This is the heart of the M.I.O.L.
 * (Mealwise Intelligent Orchestration Layer).
 */

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://esm.sh/zod@3";
import { v4 as uuidv4 } from "https://esm.sh/uuid@9";

// Import our custom types and agents
import type { 
  UserBlueprint, 
  GenerationContext,
  PlanGenerationResult,
  GenerationStage 
} from "../../../types/blueprint.ts";
import type { MealPlan } from "../../../types/plan.ts";
import { validateUserBlueprint } from "./utils/blueprint-validator.ts";
import { CandidateSelector } from "../../../agents/candidate-selector.ts";
import { NutritionCouncil } from "../../../agents/nutrition-council.ts";
import { WowLayerAgent } from "../../../agents/wow-layer.ts";
import { logGenerationEvent } from "./utils/logging.ts";

// =============================================================================
// REQUEST VALIDATION SCHEMA
// =============================================================================

const PlanGenerationRequestSchema = z.object({
  week_start_date: z.string().optional().transform(str => str ? new Date(str) : getNextMonday()),
  special_requests: z.array(z.string()).optional().default([]),
  force_regenerate: z.boolean().optional().default(false),
  preferences: z.object({
    enforce_variety: z.boolean().optional().default(true),
    max_prep_time: z.number().optional(),
    focus_macros: z.array(z.enum(['protein', 'carbs', 'fat'])).optional(),
    mood_override: z.string().optional(),
    exclude_recipes: z.array(z.string()).optional().default([])
  }).optional().default({})
});

type PlanGenerationRequest = z.infer<typeof PlanGenerationRequestSchema>;

// =============================================================================
// MAIN HANDLER
// =============================================================================

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

  const generationId = uuidv4();
  const startTime = Date.now();
  
  try {
    // Stage 0: Secure Validation
    const validationResult = await validateRequest(req, generationId);
    if (!validationResult.success) {
      return createErrorResponse(validationResult.error, validationResult.status);
    }

    const { supabase, user, requestData } = validationResult.data;
    
    // Stage 1: Blueprint Ingestion
    const blueprintResult = await ingestUserBlueprint(supabase, user.id, generationId);
    if (!blueprintResult.success) {
      return createErrorResponse(blueprintResult.error, 400);
    }

    const blueprint = blueprintResult.data;
    
    // Create generation context
    const context: GenerationContext = {
      user_blueprint: blueprint,
      generation_id: generationId,
      week_start_date: requestData.week_start_date,
      special_requests: requestData.special_requests,
      source: 'user_request',
      retry_count: 0
    };

    // Start generation logging
    await logGenerationEvent(supabase, {
      user_id: user.id,
      generation_id: generationId,
      status: 'started',
      stage: 'validation'
    });

    // Stage 2-5: Main Generation Flow with Circuit Breaker
    const generationResult = await generateMealPlanWithRetry(supabase, context, requestData.preferences);
    
    const endTime = Date.now();
    const duration = endTime - startTime;

    // Log completion
    await logGenerationEvent(supabase, {
      user_id: user.id,
      generation_id: generationId,
      status: generationResult.success ? 'completed' : 'failed',
      duration_ms: duration,
      claude_requests: generationResult.claude_requests,
      claude_tokens_used: generationResult.claude_tokens_used,
      claude_cost_cents: generationResult.claude_cost_cents,
      error_message: generationResult.error?.message,
      fallback_reason: generationResult.fallback_reason,
      recipes_selected: generationResult.meal_plan?.plan_data.total_recipes,
      nutritional_accuracy: generationResult.nutritional_accuracy
    });

    return new Response(
      JSON.stringify({
        success: generationResult.success,
        generation_id: generationId,
        plan_id: generationResult.meal_plan?.id,
        status: generationResult.used_fallback ? 'generated_with_fallback' : 'generated',
        message: generationResult.used_fallback 
          ? "We've created a starter plan for you! Our AI council is performing a deeper review to perfect your next plan."
          : "Your personalized meal plan is ready!",
        duration_ms: duration,
        total_recipes: generationResult.meal_plan?.plan_data.total_recipes,
        week_theme: generationResult.meal_plan?.week_theme,
        error: generationResult.error ? {
          code: generationResult.error.error_code,
          message: generationResult.error.message,
          stage: generationResult.error.stage
        } : undefined
      }),
      {
        status: generationResult.success ? 200 : 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );

  } catch (error) {
    console.error('Unexpected error in plan generation:', error);
    
    // Log the failure
    await logGenerationEvent(supabase, {
      user_id: 'unknown',
      generation_id: generationId,
      status: 'failed',
      duration_ms: Date.now() - startTime,
      error_message: error.message || 'Unexpected error'
    });

    return createErrorResponse('Internal server error', 500);
  }
});

// =============================================================================
// STAGE 0: SECURE VALIDATION
// =============================================================================

async function validateRequest(req: Request, generationId: string) {
  try {
    // Initialize Supabase client with user's auth context
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      {
        global: { 
          headers: { Authorization: req.headers.get("Authorization")! } 
        },
      }
    );

    // Get user from secure session
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return { 
        success: false, 
        error: 'Unauthorized: Invalid or missing authentication', 
        status: 401 
      };
    }

    // Validate request body
    const rawBody = await req.text();
    let requestData: PlanGenerationRequest;
    
    try {
      const parsedBody = rawBody ? JSON.parse(rawBody) : {};
      requestData = PlanGenerationRequestSchema.parse(parsedBody);
    } catch (validationError) {
      return {
        success: false,
        error: `Invalid request format: ${validationError.message}`,
        status: 422
      };
    }

    // Check subscription status
    const { data: subscription, error: subError } = await supabase
      .from('subscriptions')
      .select(`
        plan_id, 
        status, 
        subscription_plans!inner(
          plan_generation_limit,
          access_to_premium_content,
          advanced_wow_layers
        )
      `)
      .eq('user_id', user.id)
      .eq('status', 'active')
      .single();

    if (subError || !subscription) {
      return {
        success: false,
        error: 'No active subscription found',
        status: 403
      };
    }

    // Check generation limits (if not unlimited)
    const planLimit = subscription.subscription_plans.plan_generation_limit;
    if (planLimit !== -1) {
      const { count: monthlyPlans } = await supabase
        .from('meal_plans')
        .select('*', { count: 'exact' })
        .eq('user_id', user.id)
        .gte('created_at', new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString());

      if (monthlyPlans >= planLimit) {
        return {
          success: false,
          error: `Monthly plan generation limit reached (${planLimit} plans)`,
          status: 429
        };
      }
    }

    return {
      success: true,
      data: { supabase, user, requestData, subscription }
    };

  } catch (error) {
    return {
      success: false,
      error: `Validation error: ${error.message}`,
      status: 500
    };
  }
}

// =============================================================================
// STAGE 1: BLUEPRINT INGESTION
// =============================================================================

async function ingestUserBlueprint(supabase: any, userId: string, generationId: string): Promise<{success: boolean, data?: UserBlueprint, error?: string}> {
  try {
    // Fetch complete user profile
    const { data: profile, error: profileError } = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();

    if (profileError) {
      throw new Error(`Failed to fetch user profile: ${profileError.message}`);
    }

    // Fetch active user intake
    const { data: intake, error: intakeError } = await supabase
      .from('user_intake')
      .select('*')
      .eq('user_id', userId)
      .eq('is_active', true)
      .order('version', { ascending: false })
      .limit(1)
      .single();

    if (intakeError) {
      throw new Error(`Failed to fetch user intake: ${intakeError.message}`);
    }

    // Fetch subscription details
    const { data: subscription, error: subError } = await supabase
      .from('subscriptions')
      .select(`
        *,
        subscription_plans!inner(*)
      `)
      .eq('user_id', userId)
      .eq('status', 'active')
      .single();

    if (subError) {
      throw new Error(`Failed to fetch subscription: ${subError.message}`);
    }

    // Calculate nutritional targets
    const nutritionalTargets = calculateNutritionalTargets(profile, intake);

    // Fetch recent ratings for personalization
    const { data: recentRatings } = await supabase
      .from('user_events')
      .select('event_data, created_at')
      .eq('user_id', userId)
      .eq('event_type', 'recipe_rated')
      .order('created_at', { ascending: false })
      .limit(20);

    // Fetch recent swaps
    const { data: recentSwaps } = await supabase
      .from('user_events')
      .select('event_data, created_at')
      .eq('user_id', userId)
      .eq('event_type', 'meal_swapped')
      .order('created_at', { ascending: false })
      .limit(10);

    // Assemble complete blueprint
    const blueprint: UserBlueprint = {
      profile,
      intake,
      subscription,
      subscription_plan: subscription.subscription_plans,
      nutritional_targets: nutritionalTargets,
      gamification_context: {
        current_streak: profile.streak_days,
        available_xp_challenges: [], // TODO: Fetch from achievements system
        premium_content_unlocked: subscription.subscription_plans.access_to_premium_content,
        achievement_progress: {} // TODO: Fetch user achievements
      },
      recent_ratings: recentRatings?.map(r => ({
        recipe_id: r.event_data.recipe_id,
        rating: r.event_data.rating,
        created_at: new Date(r.created_at)
      })) || [],
      recent_swaps: recentSwaps?.map(s => ({
        original_recipe_id: s.event_data.original_recipe_id,
        replacement_recipe_id: s.event_data.replacement_recipe_id,
        meal_type: s.event_data.meal_type,
        reason: s.event_data.reason,
        created_at: new Date(s.created_at)
      })) || []
    };

    // Validate blueprint completeness
    const validation = validateUserBlueprint(blueprint);
    if (!validation.can_generate_plan) {
      return {
        success: false,
        error: `Incomplete user profile: ${validation.missing_fields.join(', ')}`
      };
    }

    return { success: true, data: blueprint };

  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

// =============================================================================
// MAIN GENERATION FLOW WITH CIRCUIT BREAKER
// =============================================================================

async function generateMealPlanWithRetry(
  supabase: any, 
  context: GenerationContext,
  preferences: any
): Promise<PlanGenerationResult> {
  const maxRetries = 3;
  let retryCount = 0;
  let lastError: any = null;
  let totalClaudeRequests = 0;
  let totalTokensUsed = 0;
  let totalCostCents = 0;

  while (retryCount < maxRetries) {
    try {
      console.log(`🚀 Generation attempt ${retryCount + 1}/${maxRetries} for user ${context.user_blueprint.profile.id}`);
      
      // Update context with current retry count
      const currentContext = { ...context, retry_count: retryCount };
      
      // Stage 2: Intelligent Candidate Selection
      console.log('📋 Stage 2: Candidate Selection');
      const candidateSelector = new CandidateSelector(supabase);
      const candidatesResult = await candidateSelector.selectCandidates(
        currentContext.user_blueprint,
        preferences
      );
      
      if (!candidatesResult.success) {
        throw new Error(`Candidate selection failed: ${candidatesResult.error}`);
      }

      totalClaudeRequests += candidatesResult.claude_requests || 0;
      totalTokensUsed += candidatesResult.tokens_used || 0;
      totalCostCents += candidatesResult.cost_cents || 0;

      // Stage 3: AI Nutrition Council
      console.log('🧠 Stage 3: AI Nutrition Council');
      const nutritionCouncil = new NutritionCouncil(supabase);
      const validationResult = await nutritionCouncil.validateAndRefine(
        candidatesResult.candidates,
        currentContext
      );

      totalClaudeRequests += validationResult.claude_requests || 0;
      totalTokensUsed += validationResult.tokens_used || 0;
      totalCostCents += validationResult.cost_cents || 0;

      if (validationResult.success) {
        // Stage 4: "Wow" Layer Enhancement
        console.log('✨ Stage 4: Wow Layer Enhancement');
        const wowAgent = new WowLayerAgent(supabase);
        const enhancedResult = await wowAgent.enhancePlan(
          validationResult.meal_plan,
          currentContext
        );

        totalClaudeRequests += enhancedResult.claude_requests || 0;
        totalTokensUsed += enhancedResult.tokens_used || 0;
        totalCostCents += enhancedResult.cost_cents || 0;

        // Stage 5: Serialization & Storage
        console.log('💾 Stage 5: Serialization & Storage');
        const finalPlan = await saveMealPlan(supabase, enhancedResult.meal_plan, currentContext);

        return {
          success: true,
          meal_plan: finalPlan,
          generation_id: context.generation_id,
          generation_time_ms: 0, // Will be calculated by caller
          retry_count,
          claude_requests: totalClaudeRequests,
          claude_tokens_used: totalTokensUsed,
          claude_cost_cents: totalCostCents,
          nutritional_accuracy: validationResult.nutritional_accuracy,
          used_fallback: false
        };
      } else {
        // Validation failed, prepare for retry
        lastError = validationResult.error;
        console.log(`⚠️ Validation failed (attempt ${retryCount + 1}): ${lastError}`);
      }

    } catch (error) {
      lastError = error;
      console.log(`❌ Generation failed (attempt ${retryCount + 1}): ${error.message}`);
    }

    retryCount++;
  }

  // Circuit breaker triggered - generate fallback plan
  console.log('🔄 Circuit breaker triggered, generating fallback plan');
  
  try {
    const fallbackPlan = await generateFallbackPlan(supabase, context);
    
    return {
      success: true,
      meal_plan: fallbackPlan,
      generation_id: context.generation_id,
      generation_time_ms: 0,
      retry_count,
      claude_requests: totalClaudeRequests,
      claude_tokens_used: totalTokensUsed,
      claude_cost_cents: totalCostCents,
      used_fallback: true,
      fallback_reason: `Generation failed after ${maxRetries} attempts: ${lastError?.message}`
    };
  } catch (fallbackError) {
    // Complete failure
    return {
      success: false,
      generation_id: context.generation_id,
      generation_time_ms: 0,
      retry_count,
      claude_requests: totalClaudeRequests,
      claude_tokens_used: totalTokensUsed,
      claude_cost_cents: totalCostCents,
      error: {
        stage: 'fallback_generation',
        error_code: 'COMPLETE_FAILURE',
        message: `All generation attempts failed. Last error: ${lastError?.message}. Fallback error: ${fallbackError.message}`,
        recoverable: true,
        suggested_action: 'Please try again in a few minutes'
      },
      used_fallback: false
    };
  }
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

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

function getNextMonday(): Date {
  const today = new Date();
  const dayOfWeek = today.getDay();
  const daysUntilMonday = dayOfWeek === 0 ? 1 : 8 - dayOfWeek;
  const nextMonday = new Date(today);
  nextMonday.setDate(today.getDate() + daysUntilMonday);
  nextMonday.setHours(0, 0, 0, 0);
  return nextMonday;
}

function calculateNutritionalTargets(profile: any, intake: any) {
  // Basic BMR calculation using Mifflin-St Jeor equation
  if (!profile.weight_kg || !profile.height_cm || !profile.date_of_birth) {
    return null;
  }

  const age = new Date().getFullYear() - new Date(profile.date_of_birth).getFullYear();
  const weight = profile.weight_kg;
  const height = profile.height_cm;
  
  // Assume male for BMR calculation (in real app, should have gender field)
  const bmr = (10 * weight) + (6.25 * height) - (5 * age) + 5;
  
  // Activity multipliers
  const activityMultipliers = {
    sedentary: 1.2,
    light: 1.375,
    moderate: 1.55,
    active: 1.725,
    very_active: 1.9
  };
  
  const tdee = bmr * (activityMultipliers[profile.activity_level] || 1.2);
  
  // Macro distribution (can be customized based on diet type)
  const proteinRatio = 0.25;
  const fatRatio = 0.30;
  const carbRatio = 0.45;
  
  return {
    daily_calories: Math.round(tdee),
    daily_protein: Math.round((tdee * proteinRatio) / 4), // 4 calories per gram
    daily_fat: Math.round((tdee * fatRatio) / 9), // 9 calories per gram
    daily_carbohydrates: Math.round((tdee * carbRatio) / 4), // 4 calories per gram
    bmr: Math.round(bmr),
    tdee: Math.round(tdee),
    calculation_method: 'mifflin_st_jeor' as const
  };
}

async function generateFallbackPlan(supabase: any, context: GenerationContext): Promise<MealPlan> {
  // Generate a simplified 3-day plan using top-rated "Universal" recipes
  console.log('🔄 Generating simplified fallback plan');
  
  // Get highly-rated, simple recipes that work for most people
  const { data: fallbackRecipes, error } = await supabase
    .from('recipes')
    .select('*')
    .eq('status', 'published')
    .gte('rating_average', 4.0)
    .lte('prep_time_minutes', 30)
    .not('dietary_tags', 'cs', '{"spicy","very_spicy"}')
    .order('rating_average', { ascending: false })
    .limit(15);

  if (error || !fallbackRecipes?.length) {
    throw new Error('Failed to fetch fallback recipes');
  }

  // Create simple 3-day plan
  const days = ['monday', 'tuesday', 'wednesday'];
  const mealTypes = ['breakfast', 'lunch', 'dinner'];
  
  const planData = {
    days: days.map((day, dayIndex) => ({
      day,
      date: new Date(context.week_start_date.getTime() + dayIndex * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      meals: mealTypes.map((mealType, mealIndex) => {
        const recipeIndex = (dayIndex * 3 + mealIndex) % fallbackRecipes.length;
        return {
          meal_type: mealType,
          recipe_id: fallbackRecipes[recipeIndex].id,
          completed: false
        };
      })
    })),
    total_recipes: 9,
    unique_recipes: Math.min(9, fallbackRecipes.length),
    variety_score: 60
  };

  const fallbackPlan: MealPlan = {
    id: uuidv4(),
    user_id: context.user_blueprint.profile.id,
    intake_id: context.user_blueprint.intake.id,
    week_theme: 'Getting Started',
    week_start_date: context.week_start_date,
    status: 'active',
    plan_data: planData,
    generated_by: 'fallback_system',
    generation_id: context.generation_id,
    completion_percentage: 0,
    is_public: false,
    clone_count: 0,
    created_at: new Date(),
    updated_at: new Date()
  };

  return fallbackPlan;
}

async function saveMealPlan(supabase: any, mealPlan: MealPlan, context: GenerationContext): Promise<MealPlan> {
  const { data, error } = await supabase
    .from('meal_plans')
    .insert({
      id: mealPlan.id,
      user_id: mealPlan.user_id,
      intake_id: mealPlan.intake_id,
      week_theme: mealPlan.week_theme,
      week_start_date: mealPlan.week_start_date.toISOString().split('T')[0],
      status: mealPlan.status,
      plan_data: mealPlan.plan_data,
      generated_by: mealPlan.generated_by,
      generation_version: '1.0.0',
      generation_id: mealPlan.generation_id,
      completion_percentage: mealPlan.completion_percentage,
      is_public: mealPlan.is_public,
      clone_count: mealPlan.clone_count
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to save meal plan: ${error.message}`);
  }

  return { ...mealPlan, ...data };
}