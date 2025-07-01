/**
 * Meal Plan Types
 * 
 * Complete TypeScript definitions for meal plans, generation results,
 * and all related structures in the plan generation engine.
 */

import type { Recipe, NutritionInfo, GroceryList, PrepSchedule } from './recipe';
import type { UserBlueprint } from './blueprint';

// =============================================================================
// CORE MEAL PLAN STRUCTURE
// =============================================================================

export interface MealPlan {
  id: string;
  user_id: string;
  intake_id?: string;
  
  // Plan metadata
  week_theme?: string;
  week_start_date: Date;
  status: PlanStatus;
  
  // Plan content
  plan_data: PlanData;
  
  // AI generation metadata
  generated_by: string;        // 'claude', 'gpt4', etc.
  generation_version?: string;
  generation_id: string;       // Links to generation logs
  prompt_used?: string;
  
  // User interaction
  user_rating?: number;        // 1-5 stars
  user_feedback?: string;
  completion_percentage: number;
  
  // Sharing
  is_public: boolean;
  clone_count: number;
  
  created_at: Date;
  updated_at: Date;
}

export type PlanStatus = 'active' | 'completed' | 'archived' | 'draft';

export interface PlanData {
  days: DayPlan[];
  
  // Plan-wide metadata
  total_recipes: number;
  unique_recipes: number;
  variety_score: number;       // 0-100, calculated variety
  
  // Nutritional summary
  nutrition_summary?: PlanNutritionSummary;
  
  // "Wow" layer enhancements
  wow_layers?: WowLayers;
}

export interface DayPlan {
  day: string;                 // 'monday', 'tuesday', etc.
  date: string;                // ISO date string
  meals: MealSlot[];
  
  // Daily summaries
  daily_nutrition?: NutritionInfo;
  daily_prep_time?: number;    // Total prep time for the day
  daily_cost_estimate?: number;
}

export interface MealSlot {
  meal_type: string;           // 'breakfast', 'lunch', 'dinner', 'snack'
  recipe_id: string;
  recipe?: Recipe;             // Populated when needed
  
  // Slot-specific overrides
  servings?: number;           // Override recipe default
  notes?: string;              // User notes for this meal
  
  // Interaction tracking
  user_rating?: 'love' | 'meh' | 'skip';
  completed: boolean;
  completed_at?: Date;
  
  // Swap history
  original_recipe_id?: string; // If this was swapped
  swap_reason?: string;
  swapped_at?: Date;
}

// =============================================================================
// NUTRITION ANALYSIS
// =============================================================================

export interface PlanNutritionSummary {
  // Daily averages
  avg_daily_calories: number;
  avg_daily_protein: number;
  avg_daily_fat: number;
  avg_daily_carbohydrates: number;
  avg_daily_fiber?: number;
  
  // Target comparison
  target_deviations: {
    calories_deviation: number;     // percentage from target
    protein_deviation: number;
    fat_deviation: number;
    carbohydrates_deviation: number;
  };
  
  // Quality metrics
  nutritional_balance_score: number; // 0-100
  meets_15_percent_rule: boolean;
  
  // Day-by-day breakdown
  daily_breakdowns: DailyNutritionBreakdown[];
}

export interface DailyNutritionBreakdown {
  day: string;
  total_calories: number;
  total_protein: number;
  total_fat: number;
  total_carbohydrates: number;
  
  // Meal contributions
  meal_contributions: {
    [meal_type: string]: {
      calories: number;
      protein: number;
      fat: number;
      carbohydrates: number;
    };
  };
}

// =============================================================================
// "WOW" LAYER ENHANCEMENTS
// =============================================================================

export interface WowLayers {
  // Smart grocery list
  grocery_list?: GroceryList;
  
  // Prep-ahead schedule
  prep_schedule?: PrepSchedule;
  
  // Mood jam assignment
  mood_jam?: MoodJamAssignment;
  
  // XP challenges
  xp_challenges?: XPChallenge[];
  
  // Additional enhancements
  cooking_tips?: CookingTip[];
  wine_pairings?: WinePairing[];
}

export interface MoodJamAssignment {
  id: string;
  meal_plan_id: string;
  
  // Mood analysis
  detected_mood: string;       // 'focus', 'comfort', 'energy', 'family'
  mood_confidence: number;     // 0-1
  mood_explanation: string;
  
  // Spotify integration
  spotify_playlist_id?: string;
  spotify_playlist_url?: string;
  playlist_name: string;
  
  // Playlist characteristics
  genres: string[];
  audio_features?: {
    energy: number;            // 0-1
    valence: number;           // 0-1 (musical positivity)
    acousticness: number;      // 0-1
    danceability: number;      // 0-1
  };
  
  // User feedback
  user_rating?: number;        // 1-5
  play_count: number;
  
  created_at: Date;
}

export interface XPChallenge {
  id: string;
  type: XPChallengeType;
  title: string;
  description: string;
  
  // Reward
  xp_reward: number;
  badge_reward?: string;
  
  // Progress tracking
  target_value: number;        // e.g., 7 for "complete 7 meals"
  current_progress: number;
  completed: boolean;
  
  // Timing
  expires_at?: Date;
  completed_at?: Date;
}

export type XPChallengeType = 
  | 'plan_completion'
  | 'streak_maintenance'
  | 'recipe_rating'
  | 'prep_efficiency'
  | 'variety_exploration';

export interface CookingTip {
  id: string;
  recipe_id: string;
  tip: string;
  category: 'efficiency' | 'technique' | 'flavor' | 'presentation';
  difficulty_level: 'beginner' | 'intermediate' | 'advanced';
}

export interface WinePairing {
  recipe_id: string;
  wine_type: string;
  specific_wines?: string[];
  pairing_reason: string;
  price_range?: 'budget' | 'mid_range' | 'premium';
}

// =============================================================================
// PLAN GENERATION RESULTS
// =============================================================================

export interface PlanGenerationResult {
  success: boolean;
  
  // Generated plan (if successful)
  meal_plan?: MealPlan;
  
  // Generation metadata
  generation_id: string;
  generation_time_ms: number;
  retry_count: number;
  
  // AI usage tracking
  claude_requests: number;
  claude_tokens_used: number;
  claude_cost_cents: number;
  
  // Quality metrics
  nutritional_accuracy?: {
    calories_deviation: number;
    protein_deviation: number;
    fat_deviation: number;
    carbohydrates_deviation: number;
  };
  
  // Error handling
  error?: PlanGenerationError;
  warnings?: string[];
  
  // Fallback information
  used_fallback: boolean;
  fallback_reason?: string;
}

export interface PlanGenerationError {
  stage: GenerationStage;
  error_code: string;
  message: string;
  details?: any;
  
  // Recovery information
  recoverable: boolean;
  suggested_action?: string;
}

export type GenerationStage = 
  | 'validation'
  | 'blueprint_ingestion'
  | 'candidate_selection'
  | 'ai_scoring'
  | 'nutrition_validation'
  | 'coherence_review'
  | 'wow_layer_generation'
  | 'serialization';

// =============================================================================
// PLAN MODIFICATION & SWAPPING
// =============================================================================

export interface MealSwapRequest {
  meal_plan_id: string;
  day: string;
  meal_type: string;
  
  // Swap preferences
  reason?: string;
  specific_recipe_id?: string;  // If user wants a specific replacement
  avoid_ingredients?: string[];
  max_prep_time?: number;
  
  // Context
  user_override: boolean;       // Bypass variety rules
  source: 'user_initiated' | 'ai_suggestion';
}

export interface MealSwapResult {
  success: boolean;
  
  // Swap details
  original_recipe_id: string;
  new_recipe_id: string;
  swap_reason: string;
  
  // Updated plan
  updated_meal_plan: MealPlan;
  
  // Nutrition impact
  nutrition_impact?: {
    calories_change: number;
    protein_change: number;
    fat_change: number;
    carbs_change: number;
  };
  
  // Error handling
  error?: string;
  warnings?: string[];
}

// =============================================================================
// PLAN ANALYTICS & TRACKING
// =============================================================================

export interface PlanGenerationLog {
  id: string;
  user_id: string;
  generation_id: string;
  
  // Status tracking
  status: 'started' | 'completed' | 'failed' | 'fallback';
  started_at: Date;
  completed_at?: Date;
  duration_ms?: number;
  
  // Performance metrics
  claude_requests: number;
  claude_tokens_used: number;
  claude_cost_cents: number;
  
  // Generation details
  retry_count: number;
  error_message?: string;
  fallback_reason?: string;
  
  // Plan characteristics
  recipes_selected?: number;
  nutritional_accuracy?: {
    calories_deviation: number;
    protein_deviation: number;
    fat_deviation: number;
    carbohydrates_deviation: number;
  };
  
  created_at: Date;
}

export interface FailedPlan {
  id: string;
  user_id: string;
  generation_id: string;
  
  // Failure details
  failure_stage: GenerationStage;
  failure_reason: string;
  
  // Context for debugging
  user_blueprint: UserBlueprint;
  attempted_recipes?: any;
  validation_results?: any;
  
  // AI debugging
  prompt_used?: string;
  ai_response?: string;
  
  // Resolution tracking
  reviewed: boolean;
  resolved: boolean;
  resolution_notes?: string;
  
  created_at: Date;
}

// =============================================================================
// UTILITY TYPES
// =============================================================================

/**
 * Request for generating a new meal plan
 */
export interface GeneratePlanRequest {
  user_id: string;
  week_start_date?: Date;       // Defaults to next Monday
  special_requests?: string[];
  force_regenerate?: boolean;   // Ignore existing plans for this week
}

/**
 * Response from plan generation endpoint
 */
export interface GeneratePlanResponse {
  success: boolean;
  plan_id?: string;
  generation_id: string;
  
  // Quick access data
  week_theme?: string;
  total_recipes?: number;
  estimated_cost?: number;
  
  // Status information
  status: 'generated' | 'generated_with_fallback' | 'failed';
  message?: string;
  
  // Error details
  error?: {
    code: string;
    message: string;
    details?: any;
  };
}

/**
 * Plan sharing data
 */
export interface SharedPlan {
  id: string;
  original_plan_id: string;
  shared_by_user_id: string;
  
  // Sharing metadata
  title: string;
  description?: string;
  tags: string[];
  
  // Engagement
  view_count: number;
  clone_count: number;
  like_count: number;
  
  // Plan preview (for display)
  preview_data: {
    week_theme: string;
    total_recipes: number;
    cuisine_types: string[];
    difficulty_level: string;
    estimated_cost?: number;
  };
  
  created_at: Date;
}