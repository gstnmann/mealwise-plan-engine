/**
 * AI Nutrition Council Agent
 * 
 * The core quality gate for meal plan validation. Ensures nutritional integrity,
 * variety, and coherence using internal USDA database and Claude validation.
 * This is Stage 3 of the meal plan generation flow.
 */

import type { 
  UserBlueprint,
  GenerationContext 
} from "../types/blueprint.ts";
import type { 
  RecipeCandidate,
  NutritionValidationResult,
  USDANutritionData
} from "../types/recipe.ts";
import type { 
  MealPlan,
  PlanData,
  MealSlot
} from "../types/plan.ts";
import { v4 as uuidv4 } from "https://esm.sh/uuid@9";

export class NutritionCouncil {
  private supabase: any;
  private claudeApiKey: string;

  constructor(supabase: any) {
    this.supabase = supabase;
    this.claudeApiKey = Deno.env.get("ANTHROPIC_API_KEY")!;
  }

  /**
   * Main validation and refinement process
   */
  async validateAndRefine(
    candidates: RecipeCandidate[],
    context: GenerationContext
  ): Promise<{
    success: boolean;
    meal_plan?: MealPlan;
    nutritional_accuracy?: any;
    error?: string;
    claude_requests?: number;
    tokens_used?: number;
    cost_cents?: number;
  }> {
    let claudeRequests = 0;
    let totalTokensUsed = 0;
    let totalCostCents = 0;

    try {
      console.log('🧠 Starting AI Nutrition Council validation');
      
      // Step 1: Assemble initial meal plan
      const assemblyResult = await this.assembleMealPlan(candidates, context);
      claudeRequests += assemblyResult.claude_requests || 0;
      totalTokensUsed += assemblyResult.tokens_used || 0;
      totalCostCents += assemblyResult.cost_cents || 0;
      
      if (!assemblyResult.success) {
        return {
          success: false,
          error: assemblyResult.error,
          claude_requests: claudeRequests,
          tokens_used: totalTokensUsed,
          cost_cents: totalCostCents
        };
      }

      let currentPlan = assemblyResult.meal_plan!;
      
      // Step 2: Validation loop with circuit breaker
      const maxRetries = 3;
      let retryCount = 0;
      let lastValidationResult: NutritionValidationResult | null = null;
      
      while (retryCount < maxRetries) {
        console.log(`🔍 Validation attempt ${retryCount + 1}/${maxRetries}`);
        
        // Nutritional feasibility check
        const nutritionResult = await this.validateNutrition(currentPlan, context.user_blueprint);
        
        if (nutritionResult.is_valid) {
          // Nutrition is good, now check coherence
          const coherenceResult = await this.validateCoherence(currentPlan, context);
          claudeRequests += 1;
          totalTokensUsed += coherenceResult.tokens_used || 0;
          totalCostCents += coherenceResult.cost_cents || 0;
          
          if (coherenceResult.success && coherenceResult.rating >= 7) {
            // Plan passes all validation!
            console.log('✅ Plan validation successful');
            return {
              success: true,
              meal_plan: currentPlan,
              nutritional_accuracy: nutritionResult.target_deviations,
              claude_requests: claudeRequests,
              tokens_used: totalTokensUsed,
              cost_cents: totalCostCents
            };
          } else {
            // Coherence failed, try to improve
            console.log('⚠️ Coherence validation failed, attempting improvement');
            const improvementResult = await this.improvePlanCoherence(
              currentPlan, 
              candidates, 
              context,
              coherenceResult.feedback
            );
            
            claudeRequests += improvementResult.claude_requests || 0;
            totalTokensUsed += improvementResult.tokens_used || 0;
            totalCostCents += improvementResult.cost_cents || 0;
            
            if (improvementResult.success) {
              currentPlan = improvementResult.meal_plan!;
            }
          }
        } else {
          // Nutrition failed, try to fix
          console.log('⚠️ Nutritional validation failed, attempting improvement');
          const nutritionFix = await this.fixNutritionalIssues(
            currentPlan,
            candidates,
            context,
            nutritionResult
          );
          
          if (nutritionFix.success) {
            currentPlan = nutritionFix.meal_plan!;
          } else {
            lastValidationResult = nutritionResult;
          }
        }
        
        retryCount++;
      }
      
      // If we get here, validation failed after max retries
      return {
        success: false,
        error: `Validation failed after ${maxRetries} attempts. Last issue: ${lastValidationResult?.suggestions?.join(', ') || 'Unknown validation error'}`,
        claude_requests: claudeRequests,
        tokens_used: totalTokensUsed,
        cost_cents: totalCostCents
      };
      
    } catch (error) {
      console.error('❌ Error in nutrition council:', error);
      return {
        success: false,
        error: error.message,
        claude_requests: claudeRequests,
        tokens_used: totalTokensUsed,
        cost_cents: totalCostCents
      };
    }
  }

  /**
   * Step 1: Assemble initial meal plan from candidates
   */
  private async assembleMealPlan(
    candidates: RecipeCandidate[],
    context: GenerationContext
  ): Promise<{
    success: boolean;
    meal_plan?: MealPlan;
    error?: string;
    claude_requests?: number;
    tokens_used?: number;
    cost_cents?: number;
  }> {
    try {
      // Use Claude to intelligently assign recipes to meal slots
      const prompt = this.buildMealAssemblyPrompt(candidates, context);
      
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': this.claudeApiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-3-5-sonnet-20241022',
          max_tokens: 3000,
          temperature: 0.3,
          messages: [{
            role: 'user',
            content: prompt
          }]
        })
      });

      if (!response.ok) {
        throw new Error(`Claude API error: ${response.status}`);
      }

      const data = await response.json();
      const aiResponse = data.content[0].text;
      
      // Parse the meal plan structure
      const parsedPlan = this.parseMealPlanResponse(aiResponse, candidates, context);
      
      if (!parsedPlan.success) {
        return {
          success: false,
          error: parsedPlan.error,
          claude_requests: 1,
          tokens_used: data.usage?.input_tokens + data.usage?.output_tokens || 0,
          cost_cents: this.calculateCost(data.usage?.input_tokens || 0, data.usage?.output_tokens || 0)
        };
      }
      
      return {
        success: true,
        meal_plan: parsedPlan.meal_plan,
        claude_requests: 1,
        tokens_used: data.usage?.input_tokens + data.usage?.output_tokens || 0,
        cost_cents: this.calculateCost(data.usage?.input_tokens || 0, data.usage?.output_tokens || 0)
      };
      
    } catch (error) {
      return {
        success: false,
        error: `Meal assembly failed: ${error.message}`
      };
    }
  }

  /**
   * Validate nutrition using internal USDA database
   */
  private async validateNutrition(
    mealPlan: MealPlan,
    blueprint: UserBlueprint
  ): Promise<NutritionValidationResult> {
    try {
      console.log('🧪 Performing nutritional validation using internal USDA database');
      
      // Calculate total nutrition for the plan
      const totalNutrition = await this.calculatePlanNutrition(mealPlan);
      
      if (!totalNutrition) {
        return {
          is_valid: false,
          total_nutrition: { calories: 0, protein: 0, fat: 0, carbohydrates: 0 },
          daily_average: { calories: 0, protein: 0, fat: 0, carbohydrates: 0 },
          target_deviations: { calories_deviation: 100, protein_deviation: 100, fat_deviation: 100, carbohydrates_deviation: 100 },
          within_15_percent_threshold: false,
          missing_nutrition_data: ['Complete nutrition calculation failed'],
          suggestions: ['Unable to validate nutrition - insufficient data']
        };
      }
      
      // Get user's nutritional targets
      const targets = blueprint.nutritional_targets;
      if (!targets) {
        return {
          is_valid: false,
          total_nutrition: totalNutrition,
          daily_average: this.calculateDailyAverage(totalNutrition, mealPlan.plan_data.days.length),
          target_deviations: { calories_deviation: 0, protein_deviation: 0, fat_deviation: 0, carbohydrates_deviation: 0 },
          within_15_percent_threshold: false,
          missing_nutrition_data: ['User nutritional targets not calculated'],
          suggestions: ['Complete user profile to enable nutritional validation']
        };
      }
      
      const dailyAverage = this.calculateDailyAverage(totalNutrition, mealPlan.plan_data.days.length);
      
      // Calculate deviations from targets
      const deviations = {
        calories_deviation: this.calculateDeviation(dailyAverage.calories, targets.daily_calories),
        protein_deviation: this.calculateDeviation(dailyAverage.protein, targets.daily_protein),
        fat_deviation: this.calculateDeviation(dailyAverage.fat, targets.daily_fat),
        carbohydrates_deviation: this.calculateDeviation(dailyAverage.carbohydrates, targets.daily_carbohydrates)
      };
      
      // Check 15% threshold rule
      const within15Percent = Object.values(deviations).every(dev => Math.abs(dev) <= 15);
      
      // Generate suggestions if needed
      const suggestions = this.generateNutritionSuggestions(deviations, targets);
      
      return {
        is_valid: within15Percent,
        total_nutrition: totalNutrition,
        daily_average: dailyAverage,
        target_deviations: deviations,
        within_15_percent_threshold: within15Percent,
        missing_nutrition_data: [], // Would list any missing ingredient data
        suggestions: within15Percent ? [] : suggestions
      };
      
    } catch (error) {
      console.error('Error in nutrition validation:', error);
      return {
        is_valid: false,
        total_nutrition: { calories: 0, protein: 0, fat: 0, carbohydrates: 0 },
        daily_average: { calories: 0, protein: 0, fat: 0, carbohydrates: 0 },
        target_deviations: { calories_deviation: 100, protein_deviation: 100, fat_deviation: 100, carbohydrates_deviation: 100 },
        within_15_percent_threshold: false,
        missing_nutrition_data: ['Validation error'],
        suggestions: [`Nutrition validation failed: ${error.message}`]
      };
    }
  }

  /**
   * Calculate nutrition for entire meal plan using USDA database
   */
  private async calculatePlanNutrition(mealPlan: MealPlan): Promise<any | null> {
    try {
      let totalCalories = 0;
      let totalProtein = 0;
      let totalFat = 0;
      let totalCarbs = 0;
      
      // Process each day
      for (const day of mealPlan.plan_data.days) {
        for (const meal of day.meals) {
          // Get recipe nutrition
          const { data: recipe, error } = await this.supabase
            .from('recipes')
            .select('nutrition_info, ingredients, servings')
            .eq('id', meal.recipe_id)
            .single();
            
          if (error || !recipe) {
            console.warn(`Could not fetch recipe ${meal.recipe_id}`);
            continue;
          }
          
          // Use Spoonacular nutrition if available, otherwise calculate from USDA
          let mealNutrition;
          if (recipe.nutrition_info && this.isReliableNutrition(recipe.nutrition_info)) {
            mealNutrition = recipe.nutrition_info;
          } else {
            // Calculate from USDA database
            mealNutrition = await this.calculateRecipeNutritionFromUSDA(recipe);
          }
          
          if (mealNutrition) {
            // Adjust for servings if different from recipe default
            const servingMultiplier = (meal.servings || 1) / (recipe.servings || 1);
            
            totalCalories += (mealNutrition.calories || 0) * servingMultiplier;
            totalProtein += (mealNutrition.protein || 0) * servingMultiplier;
            totalFat += (mealNutrition.fat || 0) * servingMultiplier;
            totalCarbs += (mealNutrition.carbohydrates || 0) * servingMultiplier;
          }
        }
      }
      
      return {
        calories: Math.round(totalCalories),
        protein: Math.round(totalProtein),
        fat: Math.round(totalFat),
        carbohydrates: Math.round(totalCarbs)
      };
      
    } catch (error) {
      console.error('Error calculating plan nutrition:', error);
      return null;
    }
  }

  /**
   * Calculate recipe nutrition from USDA database
   */
  private async calculateRecipeNutritionFromUSDA(recipe: any): Promise<any | null> {
    try {
      let totalCalories = 0;
      let totalProtein = 0;
      let totalFat = 0;
      let totalCarbs = 0;
      
      // Process main ingredients (skip minor seasonings)
      const mainIngredients = recipe.ingredients.filter((ing: any) => 
        ing.amount > 0 && !this.isMinorIngredient(ing.name)
      );
      
      for (const ingredient of mainIngredients) {
        const usdaData = await this.lookupUSDANutrition(ingredient.name);
        
        if (usdaData) {
          // Convert ingredient amount to 100g equivalent
          const amountIn100g = this.convertToStandardAmount(ingredient.amount, ingredient.unit);
          
          if (amountIn100g > 0) {
            const multiplier = amountIn100g / 100;
            
            totalCalories += (usdaData.calories || 0) * multiplier;
            totalProtein += (usdaData.protein || 0) * multiplier;
            totalFat += (usdaData.fat || 0) * multiplier;
            totalCarbs += (usdaData.carbohydrates || 0) * multiplier;
          }
        }
      }
      
      return {
        calories: Math.round(totalCalories),
        protein: Math.round(totalProtein * 10) / 10, // One decimal place
        fat: Math.round(totalFat * 10) / 10,
        carbohydrates: Math.round(totalCarbs * 10) / 10,
        calculation_method: 'usda_calculated',
        last_calculated: new Date()
      };
      
    } catch (error) {
      console.error('Error calculating USDA nutrition:', error);
      return null;
    }
  }

  /**
   * Lookup nutrition data from internal USDA database
   */
  private async lookupUSDANutrition(ingredientName: string): Promise<USDANutritionData | null> {
    try {
      const { data, error } = await this.supabase.rpc('search_nutrition_data', {
        ingredient_name: ingredientName,
        max_results: 1
      });
      
      if (error || !data || data.length === 0) {
        console.warn(`No USDA data found for ingredient: ${ingredientName}`);
        return null;
      }
      
      return data[0];
      
    } catch (error) {
      console.error('Error looking up USDA nutrition:', error);
      return null;
    }
  }

  /**
   * Validate coherence using Claude
   */
  private async validateCoherence(
    mealPlan: MealPlan,
    context: GenerationContext
  ): Promise<{
    success: boolean;
    rating: number;
    feedback: string;
    tokens_used?: number;
    cost_cents?: number;
  }> {
    try {
      const prompt = this.buildCoherencePrompt(mealPlan, context);
      
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': this.claudeApiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-3-5-sonnet-20241022',
          max_tokens: 1000,
          temperature: 0.2,
          messages: [{
            role: 'user',
            content: prompt
          }]
        })
      });

      if (!response.ok) {
        throw new Error(`Claude API error: ${response.status}`);
      }

      const data = await response.json();
      const aiResponse = data.content[0].text;
      
      // Parse coherence rating and feedback
      const result = this.parseCoherenceResponse(aiResponse);
      
      return {
        success: true,
        rating: result.rating,
        feedback: result.feedback,
        tokens_used: data.usage?.input_tokens + data.usage?.output_tokens || 0,
        cost_cents: this.calculateCost(data.usage?.input_tokens || 0, data.usage?.output_tokens || 0)
      };
      
    } catch (error) {
      return {
        success: false,
        rating: 0,
        feedback: `Coherence validation failed: ${error.message}`
      };
    }
  }

  // Helper methods
  private buildMealAssemblyPrompt(candidates: RecipeCandidate[], context: GenerationContext): string {
    const recipeList = candidates.map(c => ({
      id: c.recipe.id,
      title: c.recipe.title,
      meal_types: c.recipe.meal_type,
      prep_time: c.recipe.prep_time_minutes,
      cuisine: c.recipe.cuisine_type,
      score: c.final_score
    }));

    const startDate = context.week_start_date;
    const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    
    return `You are creating a balanced weekly meal plan. Assign recipes to specific meal slots to create variety and balance.

<available_recipes>
${JSON.stringify(recipeList, null, 2)}
</available_recipes>

<assignment_rules>
1. Each day should have breakfast, lunch, and dinner
2. Ensure variety - don't repeat cuisines on the same day
3. Consider prep time - lighter meals for busy days
4. Respect meal_types - breakfast recipes for breakfast, etc.
5. Use higher-scored recipes more prominently
6. Create a pleasant flow throughout the week
</assignment_rules>

Return ONLY a JSON object with this structure:
{
  "week_theme": "descriptive theme name",
  "days": [
    {
      "day": "monday",
      "date": "2024-01-15",
      "meals": [
        {"meal_type": "breakfast", "recipe_id": "uuid-here"},
        {"meal_type": "lunch", "recipe_id": "uuid-here"},
        {"meal_type": "dinner", "recipe_id": "uuid-here"}
      ]
    }
    // ... 7 days total
  ]
}`;
  }

  private buildCoherencePrompt(mealPlan: MealPlan, context: GenerationContext): string {
    const planSummary = this.summarizePlanForReview(mealPlan);
    
    return `Review this meal plan for taste, texture, and variety coherence.

<meal_plan>
${JSON.stringify(planSummary, null, 2)}
</meal_plan>

<user_context>
Diet: ${context.user_blueprint.intake.diet_type}
Cooking skill: ${context.user_blueprint.intake.cooking_skill_level}
Cultural preferences: ${context.user_blueprint.intake.cultural_preferences}
</user_context>

<review_criteria>
1. **Variety (30%)**: Good mix of cuisines, proteins, cooking methods
2. **Balance (25%)**: Appropriate mix of light/heavy, simple/complex meals  
3. **Flow (20%)**: Logical progression throughout the week
4. **User Fit (25%)**: Matches user's preferences and skill level
</review_criteria>

Provide:
- **rating**: Score 1-10 (7+ is acceptable)
- **feedback**: Brief explanation of strengths and any concerns

Return ONLY JSON:
{
  "rating": 8,
  "feedback": "Great variety with good balance..."
}`;
  }

  private parseCoherenceResponse(response: string): { rating: number; feedback: string } {
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          rating: parsed.rating || 0,
          feedback: parsed.feedback || 'No feedback provided'
        };
      }
    } catch (error) {
      console.error('Error parsing coherence response:', error);
    }
    
    return { rating: 0, feedback: 'Failed to parse coherence response' };
  }

  private parseMealPlanResponse(response: string, candidates: RecipeCandidate[], context: GenerationContext): {
    success: boolean;
    meal_plan?: MealPlan;
    error?: string;
  } {
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      const parsed = JSON.parse(jsonMatch[0]);
      
      if (!parsed.days || !Array.isArray(parsed.days)) {
        throw new Error('Invalid plan structure - missing days array');
      }

      // Create meal plan object
      const mealPlan: MealPlan = {
        id: uuidv4(),
        user_id: context.user_blueprint.profile.id,
        intake_id: context.user_blueprint.intake.id,
        week_theme: parsed.week_theme || 'Personalized Weekly Plan',
        week_start_date: context.week_start_date,
        status: 'active',
        plan_data: {
          days: parsed.days.map((day: any) => ({
            ...day,
            meals: day.meals.map((meal: any) => ({
              ...meal,
              completed: false
            }))
          })),
          total_recipes: parsed.days.reduce((sum: number, day: any) => sum + day.meals.length, 0),
          unique_recipes: new Set(parsed.days.flatMap((day: any) => day.meals.map((meal: any) => meal.recipe_id))).size,
          variety_score: 80 // Will be calculated properly later
        },
        generated_by: 'claude',
        generation_id: context.generation_id,
        completion_percentage: 0,
        is_public: false,
        clone_count: 0,
        created_at: new Date(),
        updated_at: new Date()
      };

      return { success: true, meal_plan: mealPlan };
      
    } catch (error) {
      return {
        success: false,
        error: `Failed to parse meal plan: ${error.message}`
      };
    }
  }

  // More helper methods...
  private calculateDeviation(actual: number, target: number): number {
    if (target === 0) return 0;
    return ((actual - target) / target) * 100;
  }

  private calculateDailyAverage(total: any, days: number): any {
    return {
      calories: Math.round(total.calories / days),
      protein: Math.round((total.protein / days) * 10) / 10,
      fat: Math.round((total.fat / days) * 10) / 10,
      carbohydrates: Math.round((total.carbohydrates / days) * 10) / 10
    };
  }

  private isReliableNutrition(nutrition: any): boolean {
    return nutrition && nutrition.calories > 0 && nutrition.protein >= 0;
  }

  private isMinorIngredient(name: string): boolean {
    const minorIngredients = ['salt', 'pepper', 'oil', 'water', 'vanilla', 'baking powder', 'garlic powder'];
    return minorIngredients.some(minor => name.toLowerCase().includes(minor));
  }

  private convertToStandardAmount(amount: number, unit: string): number {
    // Simple conversion to grams (would need more comprehensive conversion table)
    const conversions: { [unit: string]: number } = {
      'g': 1,
      'gram': 1,
      'grams': 1,
      'kg': 1000,
      'oz': 28.35,
      'pound': 453.59,
      'lb': 453.59,
      'cup': 240, // Approximate for liquids
      'tbsp': 15,
      'tsp': 5
    };
    
    const factor = conversions[unit.toLowerCase()] || 100; // Default fallback
    return amount * factor;
  }

  private generateNutritionSuggestions(deviations: any, targets: any): string[] {
    const suggestions: string[] = [];
    
    if (Math.abs(deviations.calories_deviation) > 15) {
      if (deviations.calories_deviation > 0) {
        suggestions.push('Reduce portion sizes or choose lighter recipes');
      } else {
        suggestions.push('Add snacks or choose more calorie-dense recipes');
      }
    }
    
    if (Math.abs(deviations.protein_deviation) > 15) {
      if (deviations.protein_deviation < 0) {
        suggestions.push('Include more protein-rich foods like lean meats, legumes, or dairy');
      }
    }
    
    return suggestions;
  }

  private summarizePlanForReview(mealPlan: MealPlan): any {
    // Return simplified version for Claude review
    return {
      theme: mealPlan.week_theme,
      total_recipes: mealPlan.plan_data.total_recipes,
      unique_recipes: mealPlan.plan_data.unique_recipes,
      days: mealPlan.plan_data.days.map(day => ({
        day: day.day,
        meal_count: day.meals.length
      }))
    };
  }

  private async improvePlanCoherence(plan: MealPlan, candidates: RecipeCandidate[], context: GenerationContext, feedback: string): Promise<any> {
    // Implement plan improvement logic based on coherence feedback
    return { success: false, error: 'Plan improvement not yet implemented' };
  }

  private async fixNutritionalIssues(plan: MealPlan, candidates: RecipeCandidate[], context: GenerationContext, issues: NutritionValidationResult): Promise<any> {
    // Implement nutritional issue fixing logic
    return { success: false, error: 'Nutritional fixing not yet implemented' };
  }

  private calculateCost(inputTokens: number, outputTokens: number): number {
    const inputCostPer1k = 0.003;
    const outputCostPer1k = 0.015;
    return Math.round(((inputTokens / 1000) * inputCostPer1k + (outputTokens / 1000) * outputCostPer1k) * 100);
  }
}