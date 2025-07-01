/**
 * Nutrition Validator Function
 * 
 * Standalone function for validating meal plans against nutritional targets
 * using the internal USDA database. Can be used independently or as part
 * of the main plan generation flow.
 */

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://esm.sh/zod@3";

// =============================================================================
// REQUEST VALIDATION SCHEMA
// =============================================================================

const ValidationRequestSchema = z.object({
  meal_plan_id: z.string().uuid().optional(),
  plan_data: z.object({
    days: z.array(z.object({
      meals: z.array(z.object({
        recipe_id: z.string().uuid(),
        servings: z.number().positive().optional().default(1)
      }))
    }))
  }).optional(),
  
  // Nutritional targets
  targets: z.object({
    daily_calories: z.number().positive(),
    daily_protein: z.number().positive(),
    daily_fat: z.number().positive(),
    daily_carbohydrates: z.number().positive(),
    daily_fiber: z.number().positive().optional()
  }),
  
  // Validation options
  options: z.object({
    deviation_threshold: z.number().min(1).max(50).default(15), // percentage
    require_all_recipes: z.boolean().default(true),
    use_usda_fallback: z.boolean().default(true),
    detailed_breakdown: z.boolean().default(false)
  }).default({})
});

type ValidationRequest = z.infer<typeof ValidationRequestSchema>;

// =============================================================================
// TYPES
// =============================================================================

interface NutritionData {
  calories: number;
  protein: number;
  fat: number;
  carbohydrates: number;
  fiber?: number;
}

interface ValidationResult {
  is_valid: boolean;
  total_nutrition: NutritionData;
  daily_average: NutritionData;
  target_deviations: {
    calories_deviation: number;
    protein_deviation: number;
    fat_deviation: number;
    carbohydrates_deviation: number;
    fiber_deviation?: number;
  };
  within_threshold: boolean;
  missing_nutrition_data: string[];
  suggestions: string[];
  detailed_breakdown?: DailyBreakdown[];
}

interface DailyBreakdown {
  day: string;
  nutrition: NutritionData;
  meals: MealNutrition[];
}

interface MealNutrition {
  recipe_id: string;
  recipe_title: string;
  nutrition: NutritionData;
  calculation_method: 'spoonacular' | 'usda_calculated' | 'estimated';
}

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
    let requestData: ValidationRequest;
    
    try {
      const parsedBody = JSON.parse(rawBody);
      requestData = ValidationRequestSchema.parse(parsedBody);
    } catch (validationError) {
      return createErrorResponse(`Invalid request: ${validationError.message}`, 422);
    }

    // Get plan data
    let planData;
    if (requestData.meal_plan_id) {
      // Fetch plan from database
      const { data: mealPlan, error: planError } = await supabase
        .from('meal_plans')
        .select('plan_data, user_id')
        .eq('id', requestData.meal_plan_id)
        .eq('user_id', user.id) // Ensure user owns the plan
        .single();
        
      if (planError || !mealPlan) {
        return createErrorResponse('Meal plan not found', 404);
      }
      
      planData = mealPlan.plan_data;
    } else if (requestData.plan_data) {
      planData = requestData.plan_data;
    } else {
      return createErrorResponse('Either meal_plan_id or plan_data must be provided', 422);
    }

    // Perform nutrition validation
    const validator = new NutritionValidator(supabase);
    const result = await validator.validatePlan(
      planData,
      requestData.targets,
      requestData.options
    );

    return new Response(
      JSON.stringify({
        success: true,
        validation: result,
        timestamp: new Date().toISOString()
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
    console.error('Nutrition validation error:', error);
    return createErrorResponse('Internal server error', 500);
  }
});

// =============================================================================
// NUTRITION VALIDATOR CLASS
// =============================================================================

class NutritionValidator {
  constructor(private supabase: any) {}

  async validatePlan(
    planData: any,
    targets: any,
    options: any
  ): Promise<ValidationResult> {
    console.log('🧪 Starting nutrition validation');
    
    const missingData: string[] = [];
    const suggestions: string[] = [];
    let totalNutrition: NutritionData = {
      calories: 0,
      protein: 0,
      fat: 0,
      carbohydrates: 0,
      fiber: 0
    };
    
    const detailedBreakdown: DailyBreakdown[] = [];
    
    // Process each day
    for (const day of planData.days) {
      const dayBreakdown: DailyBreakdown = {
        day: day.day || 'unknown',
        nutrition: { calories: 0, protein: 0, fat: 0, carbohydrates: 0, fiber: 0 },
        meals: []
      };
      
      // Process each meal
      for (const meal of day.meals) {
        const mealNutrition = await this.calculateMealNutrition(
          meal.recipe_id,
          meal.servings || 1,
          options.use_usda_fallback
        );
        
        if (mealNutrition) {
          // Add to totals
          totalNutrition.calories += mealNutrition.nutrition.calories;
          totalNutrition.protein += mealNutrition.nutrition.protein;
          totalNutrition.fat += mealNutrition.nutrition.fat;
          totalNutrition.carbohydrates += mealNutrition.nutrition.carbohydrates;
          totalNutrition.fiber += mealNutrition.nutrition.fiber || 0;
          
          // Add to day totals
          dayBreakdown.nutrition.calories += mealNutrition.nutrition.calories;
          dayBreakdown.nutrition.protein += mealNutrition.nutrition.protein;
          dayBreakdown.nutrition.fat += mealNutrition.nutrition.fat;
          dayBreakdown.nutrition.carbohydrates += mealNutrition.nutrition.carbohydrates;
          dayBreakdown.nutrition.fiber += mealNutrition.nutrition.fiber || 0;
          
          if (options.detailed_breakdown) {
            dayBreakdown.meals.push(mealNutrition);
          }
        } else {
          missingData.push(`Recipe ${meal.recipe_id}`);
          if (options.require_all_recipes) {
            suggestions.push(`Missing nutrition data for recipe ${meal.recipe_id}`);
          }
        }
      }
      
      if (options.detailed_breakdown) {
        detailedBreakdown.push(dayBreakdown);
      }
    }
    
    // Calculate daily averages
    const dayCount = planData.days.length;
    const dailyAverage: NutritionData = {
      calories: Math.round(totalNutrition.calories / dayCount),
      protein: Math.round((totalNutrition.protein / dayCount) * 10) / 10,
      fat: Math.round((totalNutrition.fat / dayCount) * 10) / 10,
      carbohydrates: Math.round((totalNutrition.carbohydrates / dayCount) * 10) / 10,
      fiber: Math.round((totalNutrition.fiber / dayCount) * 10) / 10
    };
    
    // Calculate deviations from targets
    const deviations = {
      calories_deviation: this.calculateDeviation(dailyAverage.calories, targets.daily_calories),
      protein_deviation: this.calculateDeviation(dailyAverage.protein, targets.daily_protein),
      fat_deviation: this.calculateDeviation(dailyAverage.fat, targets.daily_fat),
      carbohydrates_deviation: this.calculateDeviation(dailyAverage.carbohydrates, targets.daily_carbohydrates),
      fiber_deviation: targets.daily_fiber ? 
        this.calculateDeviation(dailyAverage.fiber, targets.daily_fiber) : undefined
    };
    
    // Check if within threshold
    const coreDeviations = [
      Math.abs(deviations.calories_deviation),
      Math.abs(deviations.protein_deviation),
      Math.abs(deviations.fat_deviation),
      Math.abs(deviations.carbohydrates_deviation)
    ];
    
    const withinThreshold = coreDeviations.every(dev => dev <= options.deviation_threshold);
    const isValid = withinThreshold && (options.require_all_recipes ? missingData.length === 0 : true);
    
    // Generate suggestions
    if (!withinThreshold) {
      suggestions.push(...this.generateNutritionSuggestions(deviations, targets, options.deviation_threshold));
    }
    
    const result: ValidationResult = {
      is_valid: isValid,
      total_nutrition: totalNutrition,
      daily_average: dailyAverage,
      target_deviations: deviations,
      within_threshold: withinThreshold,
      missing_nutrition_data: missingData,
      suggestions
    };
    
    if (options.detailed_breakdown) {
      result.detailed_breakdown = detailedBreakdown;
    }
    
    console.log(`✅ Validation complete: ${isValid ? 'VALID' : 'INVALID'}`);
    return result;
  }

  private async calculateMealNutrition(
    recipeId: string,
    servings: number,
    useUSDAFallback: boolean
  ): Promise<MealNutrition | null> {
    try {
      // Get recipe data
      const { data: recipe, error } = await this.supabase
        .from('recipes')
        .select('title, nutrition_info, ingredients, servings')
        .eq('id', recipeId)
        .single();
        
      if (error || !recipe) {
        console.warn(`Recipe ${recipeId} not found`);
        return null;
      }
      
      let nutrition: NutritionData;
      let calculationMethod: 'spoonacular' | 'usda_calculated' | 'estimated';
      
      // Use existing nutrition info if reliable
      if (recipe.nutrition_info && this.isReliableNutrition(recipe.nutrition_info)) {
        nutrition = {
          calories: recipe.nutrition_info.calories || 0,
          protein: recipe.nutrition_info.protein || 0,
          fat: recipe.nutrition_info.fat || 0,
          carbohydrates: recipe.nutrition_info.carbohydrates || 0,
          fiber: recipe.nutrition_info.fiber || 0
        };
        calculationMethod = 'spoonacular';
      } else if (useUSDAFallback && recipe.ingredients) {
        // Calculate from USDA database
        const usdaNutrition = await this.calculateFromUSDA(recipe.ingredients);
        if (usdaNutrition) {
          nutrition = usdaNutrition;
          calculationMethod = 'usda_calculated';
        } else {
          // Use estimation as last resort
          nutrition = this.estimateNutrition(recipe.title);
          calculationMethod = 'estimated';
        }
      } else {
        return null;
      }
      
      // Adjust for servings
      const servingMultiplier = servings / (recipe.servings || 1);
      
      return {
        recipe_id: recipeId,
        recipe_title: recipe.title,
        nutrition: {
          calories: Math.round(nutrition.calories * servingMultiplier),
          protein: Math.round((nutrition.protein * servingMultiplier) * 10) / 10,
          fat: Math.round((nutrition.fat * servingMultiplier) * 10) / 10,
          carbohydrates: Math.round((nutrition.carbohydrates * servingMultiplier) * 10) / 10,
          fiber: Math.round((nutrition.fiber * servingMultiplier) * 10) / 10
        },
        calculation_method: calculationMethod
      };
      
    } catch (error) {
      console.error(`Error calculating nutrition for recipe ${recipeId}:`, error);
      return null;
    }
  }

  private async calculateFromUSDA(ingredients: any[]): Promise<NutritionData | null> {
    try {
      let totalCalories = 0;
      let totalProtein = 0;
      let totalFat = 0;
      let totalCarbs = 0;
      let totalFiber = 0;
      
      // Process main ingredients (skip seasonings)
      const mainIngredients = ingredients.filter(ing => 
        ing.amount > 0 && !this.isMinorIngredient(ing.name)
      );
      
      for (const ingredient of mainIngredients) {
        const usdaData = await this.lookupUSDANutrition(ingredient.name);
        
        if (usdaData) {
          // Convert ingredient amount to grams
          const amountInGrams = this.convertToGrams(ingredient.amount, ingredient.unit);
          
          if (amountInGrams > 0) {
            const multiplier = amountInGrams / 100; // USDA data is per 100g
            
            totalCalories += (usdaData.calories || 0) * multiplier;
            totalProtein += (usdaData.protein || 0) * multiplier;
            totalFat += (usdaData.fat || 0) * multiplier;
            totalCarbs += (usdaData.carbohydrates || 0) * multiplier;
            totalFiber += (usdaData.fiber || 0) * multiplier;
          }
        }
      }
      
      return {
        calories: Math.round(totalCalories),
        protein: Math.round(totalProtein * 10) / 10,
        fat: Math.round(totalFat * 10) / 10,
        carbohydrates: Math.round(totalCarbs * 10) / 10,
        fiber: Math.round(totalFiber * 10) / 10
      };
      
    } catch (error) {
      console.error('Error calculating from USDA:', error);
      return null;
    }
  }

  private async lookupUSDANutrition(ingredientName: string): Promise<any | null> {
    try {
      const { data, error } = await this.supabase.rpc('search_nutrition_data', {
        ingredient_name: ingredientName,
        max_results: 1
      });
      
      if (error || !data || data.length === 0) {
        return null;
      }
      
      return data[0];
      
    } catch (error) {
      console.error('Error looking up USDA nutrition:', error);
      return null;
    }
  }

  // Helper methods
  private calculateDeviation(actual: number, target: number): number {
    if (target === 0) return 0;
    return ((actual - target) / target) * 100;
  }

  private isReliableNutrition(nutrition: any): boolean {
    return nutrition && 
           nutrition.calories > 0 && 
           nutrition.protein >= 0 && 
           nutrition.fat >= 0 && 
           nutrition.carbohydrates >= 0;
  }

  private isMinorIngredient(name: string): boolean {
    const minorIngredients = [
      'salt', 'pepper', 'water', 'vanilla', 'baking powder', 'garlic powder',
      'onion powder', 'paprika', 'oregano', 'basil', 'thyme', 'rosemary'
    ];
    return minorIngredients.some(minor => name.toLowerCase().includes(minor));
  }

  private convertToGrams(amount: number, unit: string): number {
    const conversions: { [unit: string]: number } = {
      'g': 1, 'gram': 1, 'grams': 1,
      'kg': 1000, 'kilogram': 1000,
      'oz': 28.35, 'ounce': 28.35, 'ounces': 28.35,
      'lb': 453.59, 'pound': 453.59, 'pounds': 453.59,
      'cup': 240, 'cups': 240,
      'tbsp': 15, 'tablespoon': 15, 'tablespoons': 15,
      'tsp': 5, 'teaspoon': 5, 'teaspoons': 5,
      'ml': 1, 'milliliter': 1, 'milliliters': 1,
      'l': 1000, 'liter': 1000, 'liters': 1000
    };
    
    const factor = conversions[unit.toLowerCase()] || 100; // Default fallback
    return amount * factor;
  }

  private estimateNutrition(recipeTitle: string): NutritionData {
    // Very basic estimation based on recipe title keywords
    // This is a fallback when all else fails
    const title = recipeTitle.toLowerCase();
    
    let calories = 300; // Base estimate
    let protein = 15;
    let fat = 10;
    let carbs = 30;
    let fiber = 3;
    
    // Adjust based on keywords
    if (title.includes('salad')) {
      calories = 150; protein = 8; fat = 5; carbs = 15;
    } else if (title.includes('pasta') || title.includes('rice')) {
      calories = 400; protein = 12; fat = 8; carbs = 60;
    } else if (title.includes('chicken') || title.includes('beef')) {
      calories = 350; protein = 25; fat = 15; carbs = 10;
    } else if (title.includes('soup')) {
      calories = 200; protein = 10; fat = 6; carbs = 20;
    }
    
    return { calories, protein, fat, carbohydrates: carbs, fiber };
  }

  private generateNutritionSuggestions(
    deviations: any,
    targets: any,
    threshold: number
  ): string[] {
    const suggestions: string[] = [];
    
    Object.entries(deviations).forEach(([nutrient, deviation]) => {
      if (typeof deviation === 'number' && Math.abs(deviation) > threshold) {
        const nutrientName = nutrient.replace('_deviation', '').replace('_', ' ');
        
        if (deviation > 0) {
          suggestions.push(`Reduce ${nutrientName} intake - currently ${deviation.toFixed(1)}% above target`);
        } else {
          suggestions.push(`Increase ${nutrientName} intake - currently ${Math.abs(deviation).toFixed(1)}% below target`);
        }
      }
    });
    
    return suggestions;
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