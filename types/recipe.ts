/**
 * Recipe and Nutrition Types
 * 
 * Complete TypeScript definitions for recipes, ingredients, nutrition data,
 * and all related structures used in the meal plan generation engine.
 */

// =============================================================================
// CORE RECIPE STRUCTURE
// =============================================================================

export interface Recipe {
  id: string;
  title: string;
  description?: string;
  
  // Recipe content
  ingredients: Ingredient[];
  instructions: Instruction[];
  nutrition_info?: NutritionInfo;
  
  // Metadata
  prep_time_minutes?: number;
  cook_time_minutes?: number;
  total_time_minutes?: number;
  servings: number;
  difficulty_level?: DifficultyLevel;
  
  // Categorization
  category_id?: string;
  dietary_tags: string[];
  cuisine_type?: string;
  meal_type: MealType[];
  
  // Source & attribution
  created_by_user_id?: string;
  spoonacular_id?: number;
  source_url?: string;
  status: RecipeStatus;
  
  // Premium content
  is_premium: boolean;
  
  // Media
  image_url?: string;
  video_url?: string;
  
  // Engagement metrics
  rating_average: number;
  rating_count: number;
  
  // Metadata
  created_at: Date;
  updated_at: Date;
}

export interface Ingredient {
  name: string;
  amount: number;
  unit: string;
  notes?: string;
  
  // Nutrition lookup helpers
  usda_match?: string;  // Matched USDA description
  is_main_ingredient?: boolean; // For nutrition calculation priority
  
  // Spoonacular integration
  spoonacular_id?: number;
  image?: string;
}

export interface Instruction {
  step: number;
  text: string;
  
  // Enhanced instruction data
  duration_minutes?: number;
  temperature?: string;
  equipment?: string[];
  
  // Media attachments
  image_url?: string;
  video_url?: string;
}

export interface NutritionInfo {
  // Core macronutrients (per serving)
  calories: number;
  protein: number;      // grams
  fat: number;          // grams
  carbohydrates: number; // grams
  fiber?: number;       // grams
  sugar?: number;       // grams
  sodium?: number;      // milligrams
  
  // Additional nutrients (optional)
  vitamins?: { [vitamin: string]: number };
  minerals?: { [mineral: string]: number };
  
  // Calculation metadata
  calculation_method?: 'spoonacular' | 'usda_calculated' | 'user_entered';
  last_calculated?: Date;
  confidence_score?: number; // 0-1, how accurate we think this is
}

export type DifficultyLevel = 'easy' | 'medium' | 'hard';
export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack' | 'dessert';
export type RecipeStatus = 'pending_review' | 'published' | 'archived';

// =============================================================================
// USDA NUTRITION DATABASE
// =============================================================================

export interface USDANutritionData {
  fdc_id: number;
  description: string;
  
  // Core macronutrients (per 100g)
  calories?: number;
  protein?: number;
  fat?: number;
  carbohydrates?: number;
  fiber?: number;
  sugar?: number;
  
  // Additional nutrients
  nutrients?: { [nutrient_id: string]: number };
  
  // Data source metadata
  data_type?: string;
  publication_date?: Date;
  
  created_at: Date;
  updated_at: Date;
}

export interface NutritionLookupResult {
  ingredient_name: string;
  usda_match: USDANutritionData | null;
  confidence_score: number;
  fallback_used: boolean;
  
  // Calculated nutrition per ingredient amount
  calculated_nutrition?: NutritionInfo;
}

// =============================================================================
// RECIPE SCORING & SELECTION
// =============================================================================

export interface RecipeCandidate {
  recipe: Recipe;
  
  // Scoring data
  base_score: number;          // 0-100, from SQL filtering
  ai_personalization_score: number; // 0-100, from Claude
  final_score: number;         // Combined weighted score
  
  // Matching reasons
  match_reasons: string[];
  penalty_reasons: string[];
  
  // Selection metadata
  selected_for_meal?: string;  // 'monday_breakfast', etc.
  replacement_for?: string;    // If this replaced another recipe
}

export interface RecipeFilter {
  // Hard constraints
  dietary_restrictions: string[];
  allergen_exclusions: string[];
  max_prep_time?: number;
  max_cook_time?: number;
  
  // Soft preferences
  preferred_cuisines?: string[];
  preferred_meal_types?: MealType[];
  difficulty_preference?: DifficultyLevel;
  
  // Premium access
  include_premium: boolean;
  
  // Variety controls
  exclude_recipe_ids?: string[];
  require_variety?: boolean;
}

export interface ScoringCriteria {
  // User preference weights (0-1)
  cuisine_match_weight: number;
  nutrition_match_weight: number;
  prep_time_weight: number;
  user_rating_weight: number;
  variety_weight: number;
  
  // Bonus multipliers
  premium_bonus: number;
  recent_favorite_bonus: number;
  seasonal_bonus: number;
}

// =============================================================================
// NUTRITION VALIDATION
// =============================================================================

export interface NutritionValidationResult {
  is_valid: boolean;
  
  // Calculated totals
  total_nutrition: NutritionInfo;
  daily_average: NutritionInfo;
  
  // Target comparison
  target_deviations: {
    calories_deviation: number;     // percentage
    protein_deviation: number;
    fat_deviation: number;
    carbohydrates_deviation: number;
  };
  
  // Validation details
  within_15_percent_threshold: boolean;
  missing_nutrition_data: string[];
  
  // Recommendations
  suggestions?: string[];
  swap_recommendations?: SwapRecommendation[];
}

export interface SwapRecommendation {
  meal_to_replace: string;     // 'monday_breakfast'
  current_recipe_id: string;
  suggested_recipe_id: string;
  reason: string;
  nutrition_impact: {
    calories_change: number;
    protein_change: number;
    fat_change: number;
    carbs_change: number;
  };
}

// =============================================================================
// RECIPE CATEGORIES & ORGANIZATION
// =============================================================================

export interface RecipeCategory {
  id: string;
  name: string;
  description?: string;
  color_hex: string;
  
  // Hierarchy
  parent_category_id?: string;
  sort_order?: number;
  
  created_at: Date;
}

// =============================================================================
// GROCERY LIST GENERATION
// =============================================================================

export interface GroceryItem {
  name: string;
  amount: number;
  unit: string;
  category: GroceryCategory;
  
  // Aggregation data
  source_recipes: string[];     // Recipe IDs that need this ingredient
  estimated_cost?: number;
  
  // Shopping helpers
  checked_off: boolean;
  notes?: string;
}

export type GroceryCategory = 
  | 'produce'
  | 'meat_seafood'
  | 'dairy_eggs'
  | 'pantry'
  | 'frozen'
  | 'bakery'
  | 'beverages'
  | 'condiments'
  | 'spices';

export interface GroceryList {
  id: string;
  meal_plan_id: string;
  user_id: string;
  
  // Organized items
  items_by_category: { [category in GroceryCategory]?: GroceryItem[] };
  
  // Summary
  total_items: number;
  total_estimated_cost?: number;
  completion_percentage: number;
  
  // External integrations
  instacart_cart_id?: string;
  
  created_at: Date;
  updated_at: Date;
}

// =============================================================================
// MEAL PREP SCHEDULING
// =============================================================================

export interface PrepTask {
  id: string;
  description: string;
  estimated_time_minutes: number;
  
  // Scheduling
  suggested_day: string;       // 'sunday', 'monday', etc.
  priority: PrepPriority;
  
  // Dependencies
  enables_recipes: string[];   // Recipe IDs this prep task supports
  requires_equipment: string[];
  
  // Instructions
  instructions?: string[];
  storage_instructions?: string;
}

export type PrepPriority = 'high' | 'medium' | 'low';

export interface PrepSchedule {
  meal_plan_id: string;
  tasks: PrepTask[];
  
  // Summary
  total_prep_time_minutes: number;
  recommended_prep_days: string[];
  
  created_at: Date;
}

// =============================================================================
// UTILITY TYPES
// =============================================================================

/**
 * Helper for recipe search and filtering
 */
export interface RecipeSearchParams {
  query?: string;
  meal_type?: MealType;
  dietary_tags?: string[];
  max_prep_time?: number;
  difficulty?: DifficultyLevel;
  cuisine?: string;
  
  // Pagination
  limit?: number;
  offset?: number;
  
  // Sorting
  sort_by?: 'rating' | 'prep_time' | 'created_at' | 'popularity';
  sort_order?: 'asc' | 'desc';
}

/**
 * Recipe with calculated personalization score
 */
export interface PersonalizedRecipe extends Recipe {
  personalization_score: number;
  match_explanation: string[];
  last_scored_at: Date;
}