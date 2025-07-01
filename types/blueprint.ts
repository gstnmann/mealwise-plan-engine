/**
 * User Blueprint Types
 * 
 * Complete TypeScript definitions for user profiles, preferences, and intake data
 * used throughout the meal plan generation engine.
 */

// =============================================================================
// CORE USER PROFILE
// =============================================================================

export interface UserProfile {
  id: string;
  email: string;
  full_name?: string;
  
  // Physical characteristics
  date_of_birth?: Date;
  height_cm?: number;
  weight_kg?: number;
  activity_level?: ActivityLevel;
  
  // Gamification
  current_xp: number;
  current_level: number;
  streak_days: number;
  last_activity_date?: Date;
  
  // Metadata
  created_at: Date;
  updated_at: Date;
}

export type ActivityLevel = 
  | 'sedentary' 
  | 'light' 
  | 'moderate' 
  | 'active' 
  | 'very_active';

// =============================================================================
// USER INTAKE & PREFERENCES
// =============================================================================

export interface UserIntake {
  id: string;
  user_id: string;
  
  // Dietary preferences
  diet_type?: DietType;
  allergies: string[];
  dislikes: string[];
  
  // Goals & constraints
  health_goals: HealthGoal[];
  budget_range?: BudgetRange;
  cooking_time_preference?: number; // max minutes per meal
  cooking_skill_level?: SkillLevel;
  
  // Lifestyle
  household_size: number;
  kitchen_equipment: string[];
  
  // Preferences
  flavor_preferences?: FlavorPreferences;
  cultural_preferences?: string[];
  
  // Versioning
  version: number;
  is_active: boolean;
  created_at: Date;
}

export type DietType = 
  | 'omnivore' 
  | 'vegetarian' 
  | 'vegan' 
  | 'keto' 
  | 'paleo' 
  | 'pcos';

export type HealthGoal = 
  | 'weight_loss'
  | 'muscle_gain'
  | 'maintenance'
  | 'energy_boost'
  | 'heart_health'
  | 'digestive_health';

export type BudgetRange = 'low' | 'medium' | 'high';

export type SkillLevel = 'beginner' | 'intermediate' | 'advanced';

export interface FlavorPreferences {
  spicy: number;     // 0-10 scale
  sweet: number;     // 0-10 scale
  savory: number;    // 0-10 scale
  umami: number;     // 0-10 scale
  bitter: number;    // 0-10 scale
  sour: number;      // 0-10 scale
}

// =============================================================================
// SUBSCRIPTION & PERMISSIONS
// =============================================================================

export interface UserSubscription {
  id: string;
  user_id: string;
  plan_id: string;
  status: SubscriptionStatus;
  current_period_start: Date;
  current_period_end: Date;
  stripe_subscription_id?: string;
  stripe_customer_id?: string;
}

export type SubscriptionStatus = 
  | 'active' 
  | 'canceled' 
  | 'past_due' 
  | 'trialing';

export interface SubscriptionPlan {
  id: string;
  name: string;
  description?: string;
  price_monthly?: number;
  price_yearly?: number;
  
  // Feature gates
  plan_generation_limit: number; // -1 = unlimited
  access_to_premium_content: boolean;
  household_members_allowed: number;
  advanced_wow_layers: boolean;
  community_features: boolean;
}

// =============================================================================
// COMPLETE USER BLUEPRINT
// =============================================================================

/**
 * Complete user blueprint combining all profile data
 * This is the primary input to the meal plan generation engine
 */
export interface UserBlueprint {
  // Core profile
  profile: UserProfile;
  intake: UserIntake;
  subscription: UserSubscription;
  subscription_plan: SubscriptionPlan;
  
  // Calculated nutritional targets
  nutritional_targets?: NutritionalTargets;
  
  // Gamification context
  gamification_context?: GamificationContext;
  
  // Recent preferences (for personalization)
  recent_ratings?: RecentRating[];
  recent_swaps?: RecentSwap[];
}

export interface NutritionalTargets {
  daily_calories: number;
  daily_protein: number;    // grams
  daily_fat: number;        // grams
  daily_carbohydrates: number; // grams
  daily_fiber?: number;     // grams
  
  // Calculation metadata
  bmr?: number;             // Base Metabolic Rate
  tdee?: number;            // Total Daily Energy Expenditure
  calculation_method: 'harris_benedict' | 'mifflin_st_jeor' | 'user_defined';
}

export interface GamificationContext {
  current_streak: number;
  available_xp_challenges: string[];
  premium_content_unlocked: boolean;
  achievement_progress: { [achievement_id: string]: number };
}

export interface RecentRating {
  recipe_id: string;
  rating: 'love' | 'meh' | 'skip';
  created_at: Date;
}

export interface RecentSwap {
  original_recipe_id: string;
  replacement_recipe_id: string;
  meal_type: string;
  reason?: string;
  created_at: Date;
}

// =============================================================================
// UTILITY TYPES
// =============================================================================

/**
 * Request context for plan generation
 */
export interface GenerationContext {
  user_blueprint: UserBlueprint;
  generation_id: string;
  week_start_date: Date;
  special_requests?: string[];
  source: 'user_request' | 'automated_replan' | 'swap_meal';
  retry_count?: number;
}

/**
 * Plan generation preferences that can override defaults
 */
export interface GenerationPreferences {
  enforce_variety?: boolean;  // Can be false for user-initiated swaps
  max_prep_time?: number;     // Override user's usual preference
  focus_macros?: ('protein' | 'carbs' | 'fat')[];
  mood_override?: string;     // Force a specific mood/vibe
  exclude_recipes?: string[]; // Temporarily exclude certain recipes
}

// =============================================================================
// VALIDATION SCHEMAS
// =============================================================================

/**
 * Blueprint validation status
 */
export interface BlueprintValidation {
  is_valid: boolean;
  missing_fields: string[];
  warnings: string[];
  nutritional_targets_calculated: boolean;
  can_generate_plan: boolean;
}

/**
 * Helper function type for blueprint validation
 */
export type BlueprintValidator = (blueprint: UserBlueprint) => BlueprintValidation;