/**
 * Candidate Selector Agent
 * 
 * Intelligent recipe filtering and AI-powered personalization scoring.
 * This is Stage 2 of the meal plan generation flow.
 */

import type { 
  UserBlueprint, 
  GenerationPreferences 
} from "../types/blueprint.ts";
import type { 
  Recipe, 
  RecipeCandidate, 
  RecipeFilter, 
  ScoringCriteria 
} from "../types/recipe.ts";

export class CandidateSelector {
  private supabase: any;
  private claudeApiKey: string;

  constructor(supabase: any) {
    this.supabase = supabase;
    this.claudeApiKey = Deno.env.get("ANTHROPIC_API_KEY")!;
  }

  /**
   * Main entry point for candidate selection
   */
  async selectCandidates(
    blueprint: UserBlueprint,
    preferences: GenerationPreferences = {}
  ): Promise<{
    success: boolean;
    candidates?: RecipeCandidate[];
    error?: string;
    claude_requests?: number;
    tokens_used?: number;
    cost_cents?: number;
  }> {
    try {
      console.log('🔍 Starting candidate selection for user:', blueprint.profile.id);
      
      // Step 1: SQL-based filtering for hard constraints
      const sqlCandidates = await this.performSQLFiltering(blueprint, preferences);
      
      if (sqlCandidates.length === 0) {
        return {
          success: false,
          error: 'No recipes found matching dietary restrictions and constraints'
        };
      }

      console.log(`📊 SQL filtering returned ${sqlCandidates.length} candidates`);

      // Step 2: AI-powered personalization scoring
      const scoringResult = await this.performAIScoring(sqlCandidates, blueprint, preferences);
      
      if (!scoringResult.success) {
        return {
          success: false,
          error: scoringResult.error,
          claude_requests: 1,
          tokens_used: scoringResult.tokens_used || 0,
          cost_cents: scoringResult.cost_cents || 0
        };
      }

      // Step 3: Final candidate ranking and selection
      const finalCandidates = this.rankAndSelectFinalCandidates(
        scoringResult.scoredCandidates!,
        blueprint,
        preferences
      );

      console.log(`✅ Selected ${finalCandidates.length} final candidates`);

      return {
        success: true,
        candidates: finalCandidates,
        claude_requests: 1,
        tokens_used: scoringResult.tokens_used || 0,
        cost_cents: scoringResult.cost_cents || 0
      };

    } catch (error) {
      console.error('❌ Error in candidate selection:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Step 1: SQL-based filtering for hard constraints
   */
  private async performSQLFiltering(
    blueprint: UserBlueprint,
    preferences: GenerationPreferences
  ): Promise<Recipe[]> {
    const filter = this.buildRecipeFilter(blueprint, preferences);
    
    let query = this.supabase
      .from('recipes')
      .select(`
        id, title, description, ingredients, instructions, nutrition_info,
        prep_time_minutes, cook_time_minutes, servings, difficulty_level,
        category_id, dietary_tags, cuisine_type, meal_type,
        is_premium, image_url, rating_average, rating_count,
        created_at, updated_at
      `)
      .eq('status', 'published');

    // Apply dietary restrictions
    if (filter.dietary_restrictions.length > 0) {
      query = query.contains('dietary_tags', filter.dietary_restrictions);
    }

    // Exclude allergens
    if (filter.allergen_exclusions.length > 0) {
      filter.allergen_exclusions.forEach(allergen => {
        query = query.not('dietary_tags', 'cs', `{"${allergen}"}`);
        // Also check ingredients for common allergens
        query = query.not('ingredients', 'ilike', `%${allergen}%`);
      });
    }

    // Time constraints
    if (filter.max_prep_time) {
      query = query.lte('prep_time_minutes', filter.max_prep_time);
    }
    if (filter.max_cook_time) {
      query = query.lte('cook_time_minutes', filter.max_cook_time);
    }

    // Premium access
    if (!filter.include_premium) {
      query = query.eq('is_premium', false);
    }

    // Exclude specific recipes (for variety)
    if (filter.exclude_recipe_ids && filter.exclude_recipe_ids.length > 0) {
      query = query.not('id', 'in', `(${filter.exclude_recipe_ids.map(id => `'${id}'`).join(',')})`);
    }

    // Soft preferences (will be weighted in AI scoring)
    if (filter.preferred_cuisines && filter.preferred_cuisines.length > 0) {
      // Don't filter hard, but prioritize in scoring
    }

    // Order by rating and limit to manageable set
    query = query
      .order('rating_average', { ascending: false })
      .order('rating_count', { ascending: false })
      .limit(50); // Reasonable set for AI scoring

    const { data, error } = await query;

    if (error) {
      throw new Error(`SQL filtering failed: ${error.message}`);
    }

    return data || [];
  }

  /**
   * Step 2: AI-powered personalization scoring
   */
  private async performAIScoring(
    recipes: Recipe[],
    blueprint: UserBlueprint,
    preferences: GenerationPreferences
  ): Promise<{
    success: boolean;
    scoredCandidates?: RecipeCandidate[];
    error?: string;
    tokens_used?: number;
    cost_cents?: number;
  }> {
    try {
      const prompt = this.buildScoringPrompt(recipes, blueprint, preferences);
      
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': this.claudeApiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-3-5-sonnet-20241022',
          max_tokens: 4000,
          temperature: 0.3,
          messages: [{
            role: 'user',
            content: prompt
          }]
        })
      });

      if (!response.ok) {
        throw new Error(`Claude API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      const aiResponse = data.content[0].text;
      
      // Parse AI response
      const scoringResult = this.parseAIScoringResponse(aiResponse, recipes);
      
      if (!scoringResult.success) {
        return {
          success: false,
          error: scoringResult.error,
          tokens_used: data.usage?.input_tokens + data.usage?.output_tokens || 0,
          cost_cents: this.calculateCost(data.usage?.input_tokens || 0, data.usage?.output_tokens || 0)
        };
      }

      return {
        success: true,
        scoredCandidates: scoringResult.candidates,
        tokens_used: data.usage?.input_tokens + data.usage?.output_tokens || 0,
        cost_cents: this.calculateCost(data.usage?.input_tokens || 0, data.usage?.output_tokens || 0)
      };

    } catch (error) {
      return {
        success: false,
        error: `AI scoring failed: ${error.message}`
      };
    }
  }

  /**
   * Step 3: Final ranking and selection
   */
  private rankAndSelectFinalCandidates(
    scoredCandidates: RecipeCandidate[],
    blueprint: UserBlueprint,
    preferences: GenerationPreferences
  ): RecipeCandidate[] {
    const criteria = this.buildScoringCriteria(blueprint, preferences);
    
    // Calculate final scores
    scoredCandidates.forEach(candidate => {
      candidate.final_score = this.calculateFinalScore(candidate, criteria, blueprint);
    });

    // Sort by final score
    scoredCandidates.sort((a, b) => b.final_score - a.final_score);

    // Select diverse set for meal planning
    return this.selectDiverseSet(scoredCandidates, blueprint);
  }

  /**
   * Build recipe filter from user blueprint
   */
  private buildRecipeFilter(
    blueprint: UserBlueprint,
    preferences: GenerationPreferences
  ): RecipeFilter {
    const intake = blueprint.intake;
    const subscription = blueprint.subscription_plan;

    // Build dietary restrictions array
    const dietaryRestrictions: string[] = [];
    if (intake.diet_type && intake.diet_type !== 'omnivore') {
      dietaryRestrictions.push(intake.diet_type);
    }

    // Build allergen exclusions
    const allergenExclusions = [...(intake.allergies || []), ...(intake.dislikes || [])];

    return {
      dietary_restrictions: dietaryRestrictions,
      allergen_exclusions: allergenExclusions,
      max_prep_time: preferences.max_prep_time || intake.cooking_time_preference,
      max_cook_time: preferences.max_prep_time ? preferences.max_prep_time + 30 : undefined,
      preferred_cuisines: intake.cultural_preferences,
      preferred_meal_types: undefined, // Will be determined during plan assembly
      difficulty_preference: intake.cooking_skill_level === 'beginner' ? 'easy' : undefined,
      include_premium: subscription.access_to_premium_content,
      exclude_recipe_ids: preferences.exclude_recipes,
      require_variety: preferences.enforce_variety !== false
    };
  }

  /**
   * Build scoring criteria based on user preferences
   */
  private buildScoringCriteria(
    blueprint: UserBlueprint,
    preferences: GenerationPreferences
  ): ScoringCriteria {
    const intake = blueprint.intake;
    
    return {
      cuisine_match_weight: intake.cultural_preferences?.length ? 0.3 : 0.1,
      nutrition_match_weight: preferences.focus_macros?.length ? 0.4 : 0.2,
      prep_time_weight: intake.cooking_time_preference ? 0.2 : 0.1,
      user_rating_weight: 0.2,
      variety_weight: preferences.enforce_variety !== false ? 0.15 : 0.05,
      premium_bonus: blueprint.subscription_plan.access_to_premium_content ? 1.1 : 1.0,
      recent_favorite_bonus: 1.2,
      seasonal_bonus: 1.05
    };
  }

  /**
   * Build Claude prompt for recipe scoring
   */
  private buildScoringPrompt(
    recipes: Recipe[],
    blueprint: UserBlueprint,
    preferences: GenerationPreferences
  ): string {
    const userProfile = this.summarizeUserProfile(blueprint);
    const recipeList = recipes.map(r => ({
      id: r.id,
      title: r.title,
      cuisine: r.cuisine_type,
      dietary_tags: r.dietary_tags,
      prep_time: r.prep_time_minutes,
      difficulty: r.difficulty_level,
      rating: r.rating_average,
      meal_types: r.meal_type
    }));

    return `You are an expert meal planning AI that scores recipes for personalization.

<user_profile>
${JSON.stringify(userProfile, null, 2)}
</user_profile>

<recipes_to_score>
${JSON.stringify(recipeList, null, 2)}
</recipes_to_score>

<scoring_instructions>
Score each recipe from 0-100 based on how well it matches this specific user's preferences:

1. **Dietary Alignment** (25 points): How well does it match their diet type, avoid allergens, and align with health goals?
2. **Cultural & Flavor Preferences** (25 points): Does it match their cultural preferences and flavor profile?
3. **Lifestyle Fit** (25 points): Does the prep time, difficulty, and serving size work for their lifestyle?
4. **Personal History** (25 points): Based on their recent ratings and swaps, would they likely enjoy this?

For each recipe, provide:
- **score**: Number 0-100
- **match_reasons**: Array of strings explaining why it's a good match
- **penalty_reasons**: Array of strings explaining any concerns

Return ONLY a valid JSON object with this structure:
{
  "recipe_scores": {
    "recipe_id_1": {
      "score": 85,
      "match_reasons": ["Perfect for keto diet", "Quick prep time"],
      "penalty_reasons": ["Might be too spicy"]
    },
    // ... more recipes
  }
}
</scoring_instructions>`;
  }

  /**
   * Parse AI scoring response
   */
  private parseAIScoringResponse(
    aiResponse: string,
    recipes: Recipe[]
  ): { success: boolean; candidates?: RecipeCandidate[]; error?: string } {
    try {
      // Extract JSON from response
      const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in AI response');
      }

      const parsedResponse = JSON.parse(jsonMatch[0]);
      const recipeScores = parsedResponse.recipe_scores;

      if (!recipeScores) {
        throw new Error('No recipe_scores found in AI response');
      }

      const candidates: RecipeCandidate[] = recipes.map(recipe => {
        const scoreData = recipeScores[recipe.id];
        
        if (!scoreData) {
          console.warn(`No score found for recipe ${recipe.id}`);
          return {
            recipe,
            base_score: 50, // Default score
            ai_personalization_score: 50,
            final_score: 50,
            match_reasons: [],
            penalty_reasons: ['No AI score available']
          };
        }

        return {
          recipe,
          base_score: recipe.rating_average * 20, // Convert 5-star to 100-point scale
          ai_personalization_score: scoreData.score || 50,
          final_score: 0, // Will be calculated later
          match_reasons: scoreData.match_reasons || [],
          penalty_reasons: scoreData.penalty_reasons || []
        };
      });

      return { success: true, candidates };

    } catch (error) {
      return {
        success: false,
        error: `Failed to parse AI response: ${error.message}`
      };
    }
  }

  /**
   * Calculate final score with all factors
   */
  private calculateFinalScore(
    candidate: RecipeCandidate,
    criteria: ScoringCriteria,
    blueprint: UserBlueprint
  ): number {
    let score = 0;
    
    // Base score (recipe quality)
    score += candidate.base_score * 0.3;
    
    // AI personalization score
    score += candidate.ai_personalization_score * 0.4;
    
    // User history bonus
    const recentFavoriteBonus = this.getRecentFavoriteBonus(candidate.recipe, blueprint);
    score *= recentFavoriteBonus;
    
    // Premium bonus
    if (candidate.recipe.is_premium && blueprint.subscription_plan.access_to_premium_content) {
      score *= criteria.premium_bonus;
    }
    
    // Penalty for recent swaps (avoid recipes they swapped away from)
    const swapPenalty = this.getSwapPenalty(candidate.recipe, blueprint);
    score *= swapPenalty;
    
    return Math.min(Math.max(score, 0), 100);
  }

  /**
   * Select diverse set of candidates for meal planning
   */
  private selectDiverseSet(candidates: RecipeCandidate[], blueprint: UserBlueprint): RecipeCandidate[] {
    const selected: RecipeCandidate[] = [];
    const targetCount = 30; // Good number for meal plan assembly
    
    // Track diversity metrics
    const cuisineCount: { [cuisine: string]: number } = {};
    const mealTypeCount: { [mealType: string]: number } = {};
    const difficultyCount: { [difficulty: string]: number } = {};
    
    for (const candidate of candidates) {
      if (selected.length >= targetCount) break;
      
      const recipe = candidate.recipe;
      
      // Check diversity constraints
      const cuisineLimit = Math.ceil(targetCount / 5); // Max 6 recipes per cuisine
      const mealTypeLimit = Math.ceil(targetCount / 3); // Max 10 recipes per meal type
      
      let skipForDiversity = false;
      
      // Cuisine diversity
      if (recipe.cuisine_type) {
        const count = cuisineCount[recipe.cuisine_type] || 0;
        if (count >= cuisineLimit) {
          skipForDiversity = true;
        }
      }
      
      // Meal type diversity
      recipe.meal_type.forEach(mealType => {
        const count = mealTypeCount[mealType] || 0;
        if (count >= mealTypeLimit) {
          skipForDiversity = true;
        }
      });
      
      if (skipForDiversity && selected.length > 15) {
        continue; // Allow some flexibility early on
      }
      
      // Add to selected
      selected.push(candidate);
      
      // Update diversity counters
      if (recipe.cuisine_type) {
        cuisineCount[recipe.cuisine_type] = (cuisineCount[recipe.cuisine_type] || 0) + 1;
      }
      
      recipe.meal_type.forEach(mealType => {
        mealTypeCount[mealType] = (mealTypeCount[mealType] || 0) + 1;
      });
      
      if (recipe.difficulty_level) {
        difficultyCount[recipe.difficulty_level] = (difficultyCount[recipe.difficulty_level] || 0) + 1;
      }
    }
    
    console.log(`📊 Diversity metrics:`, {
      totalSelected: selected.length,
      cuisines: Object.keys(cuisineCount).length,
      avgScore: selected.reduce((sum, c) => sum + c.final_score, 0) / selected.length
    });
    
    return selected;
  }

  /**
   * Helper functions
   */
  private summarizeUserProfile(blueprint: UserBlueprint): any {
    return {
      diet_type: blueprint.intake.diet_type,
      allergies: blueprint.intake.allergies,
      dislikes: blueprint.intake.dislikes,
      health_goals: blueprint.intake.health_goals,
      cooking_skill: blueprint.intake.cooking_skill_level,
      cooking_time_preference: blueprint.intake.cooking_time_preference,
      cultural_preferences: blueprint.intake.cultural_preferences,
      flavor_preferences: blueprint.intake.flavor_preferences,
      recent_ratings: blueprint.recent_ratings?.slice(0, 5), // Last 5 ratings
      recent_swaps: blueprint.recent_swaps?.slice(0, 3) // Last 3 swaps
    };
  }

  private getRecentFavoriteBonus(recipe: Recipe, blueprint: UserBlueprint): number {
    const recentLoves = blueprint.recent_ratings?.filter(r => r.rating === 'love') || [];
    
    // Check if this recipe or similar recipes were recently loved
    for (const rating of recentLoves) {
      if (rating.recipe_id === recipe.id) {
        return 1.3; // Strong bonus for exact match
      }
      // Could add logic for similar recipes (same cuisine, similar ingredients)
    }
    
    return 1.0; // No bonus
  }

  private getSwapPenalty(recipe: Recipe, blueprint: UserBlueprint): number {
    const recentSwaps = blueprint.recent_swaps || [];
    
    // Check if this recipe was recently swapped away from
    for (const swap of recentSwaps) {
      if (swap.original_recipe_id === recipe.id) {
        return 0.7; // Penalty for swapped-away recipes
      }
    }
    
    return 1.0; // No penalty
  }

  private calculateCost(inputTokens: number, outputTokens: number): number {
    const inputCostPer1k = 0.003;
    const outputCostPer1k = 0.015;
    
    const inputCost = (inputTokens / 1000) * inputCostPer1k;
    const outputCost = (outputTokens / 1000) * outputCostPer1k;
    
    return Math.round((inputCost + outputCost) * 100);
  }
}