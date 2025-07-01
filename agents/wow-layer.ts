/**
 * Wow Layer Agent
 * 
 * Responsible for enhancing meal plans with "wow" layer features:
 * - Smart grocery lists with quantity aggregation
 * - Prep-ahead scheduling for efficiency
 * - XP challenge integration for gamification
 * - Cooking tips and wine pairings
 * 
 * This is Stage 4 of the meal plan generation flow.
 */

import type { 
  UserBlueprint,
  GenerationContext 
} from "../types/blueprint.ts";
import type { 
  MealPlan,
  WowLayers,
  XPChallenge,
  CookingTip
} from "../types/plan.ts";
import type {
  GroceryList,
  GroceryItem,
  GroceryCategory,
  PrepSchedule,
  PrepTask
} from "../types/recipe.ts";
import { MoodJamAgent } from "./mood-jam.ts";
import { v4 as uuidv4 } from "https://esm.sh/uuid@9";

export class WowLayerAgent {
  private supabase: any;
  private moodJamAgent: MoodJamAgent;

  constructor(supabase: any) {
    this.supabase = supabase;
    this.moodJamAgent = new MoodJamAgent(supabase);
  }

  /**
   * Main entry point for wow layer enhancement
   */
  async enhancePlan(
    mealPlan: MealPlan,
    context: GenerationContext
  ): Promise<{
    success: boolean;
    meal_plan?: MealPlan;
    error?: string;
    claude_requests?: number;
    tokens_used?: number;
    cost_cents?: number;
  }> {
    let totalClaudeRequests = 0;
    let totalTokensUsed = 0;
    let totalCostCents = 0;

    try {
      console.log('✨ Starting wow layer enhancement');
      
      const wowLayers: WowLayers = {};
      
      // Generate smart grocery list
      console.log('🛒 Generating smart grocery list');
      const groceryList = await this.generateSmartGroceryList(mealPlan, context);
      if (groceryList) {
        wowLayers.grocery_list = groceryList;
      }
      
      // Generate prep-ahead schedule
      console.log('📅 Creating prep-ahead schedule');
      const prepSchedule = await this.generatePrepSchedule(mealPlan, context);
      if (prepSchedule) {
        wowLayers.prep_schedule = prepSchedule;
      }
      
      // Assign mood jam (Spotify playlist)
      console.log('🎵 Assigning mood jam');
      const moodJamResult = await this.moodJamAgent.assignMoodJam(mealPlan, context);
      totalClaudeRequests += moodJamResult.claude_requests || 0;
      totalTokensUsed += moodJamResult.tokens_used || 0;
      totalCostCents += moodJamResult.cost_cents || 0;
      
      if (moodJamResult.success && moodJamResult.mood_jam) {
        wowLayers.mood_jam = moodJamResult.mood_jam;
      }
      
      // Generate XP challenges
      console.log('🎮 Creating XP challenges');
      const xpChallenges = await this.generateXPChallenges(mealPlan, context);
      if (xpChallenges.length > 0) {
        wowLayers.xp_challenges = xpChallenges;
      }
      
      // Add cooking tips (if user has premium features)
      if (context.user_blueprint.subscription_plan.advanced_wow_layers) {
        console.log('💡 Adding cooking tips');
        const cookingTips = await this.generateCookingTips(mealPlan, context);
        if (cookingTips.length > 0) {
          wowLayers.cooking_tips = cookingTips;
        }
      }
      
      // Update meal plan with wow layers
      const enhancedPlan: MealPlan = {
        ...mealPlan,
        plan_data: {
          ...mealPlan.plan_data,
          wow_layers: wowLayers
        }
      };
      
      console.log('✅ Wow layer enhancement completed');
      
      return {
        success: true,
        meal_plan: enhancedPlan,
        claude_requests: totalClaudeRequests,
        tokens_used: totalTokensUsed,
        cost_cents: totalCostCents
      };
      
    } catch (error) {
      console.error('❌ Error in wow layer enhancement:', error);
      return {
        success: false,
        error: error.message,
        claude_requests: totalClaudeRequests,
        tokens_used: totalTokensUsed,
        cost_cents: totalCostCents
      };
    }
  }

  /**
   * Generate smart grocery list with quantity aggregation
   */
  private async generateSmartGroceryList(
    mealPlan: MealPlan,
    context: GenerationContext
  ): Promise<GroceryList | null> {
    try {
      // Extract all ingredients from all recipes
      const allIngredients: { [key: string]: {
        amount: number;
        unit: string;
        category: GroceryCategory;
        source_recipes: string[];
      }} = {};
      
      for (const day of mealPlan.plan_data.days) {
        for (const meal of day.meals) {
          // Fetch recipe ingredients
          const { data: recipe, error } = await this.supabase
            .from('recipes')
            .select('ingredients, servings, title')
            .eq('id', meal.recipe_id)
            .single();
            
          if (error || !recipe) {
            console.warn(`Could not fetch recipe ${meal.recipe_id} for grocery list`);
            continue;
          }
          
          // Process each ingredient
          for (const ingredient of recipe.ingredients) {
            const normalizedName = this.normalizeIngredientName(ingredient.name);
            const category = this.categorizeIngredient(ingredient.name);
            
            if (allIngredients[normalizedName]) {
              // Aggregate quantities (if same unit)
              if (allIngredients[normalizedName].unit === ingredient.unit) {
                allIngredients[normalizedName].amount += ingredient.amount;
              }
              allIngredients[normalizedName].source_recipes.push(meal.recipe_id);
            } else {
              allIngredients[normalizedName] = {
                amount: ingredient.amount,
                unit: ingredient.unit,
                category,
                source_recipes: [meal.recipe_id]
              };
            }
          }
        }
      }
      
      // Organize by category
      const itemsByCategory: { [category in GroceryCategory]?: GroceryItem[] } = {};
      
      Object.entries(allIngredients).forEach(([name, data]) => {
        const item: GroceryItem = {
          name,
          amount: data.amount,
          unit: data.unit,
          category: data.category,
          source_recipes: data.source_recipes,
          checked_off: false
        };
        
        if (!itemsByCategory[data.category]) {
          itemsByCategory[data.category] = [];
        }
        itemsByCategory[data.category]!.push(item);
      });
      
      // Sort items within each category
      Object.values(itemsByCategory).forEach(items => {
        items?.sort((a, b) => a.name.localeCompare(b.name));
      });
      
      const groceryList: GroceryList = {
        id: uuidv4(),
        meal_plan_id: mealPlan.id,
        user_id: mealPlan.user_id,
        items_by_category: itemsByCategory,
        total_items: Object.values(allIngredients).length,
        completion_percentage: 0,
        created_at: new Date(),
        updated_at: new Date()
      };
      
      return groceryList;
      
    } catch (error) {
      console.error('Error generating grocery list:', error);
      return null;
    }
  }

  /**
   * Generate prep-ahead schedule
   */
  private async generatePrepSchedule(
    mealPlan: MealPlan,
    context: GenerationContext
  ): Promise<PrepSchedule | null> {
    try {
      const prepTasks: PrepTask[] = [];
      const processedIngredients = new Set<string>();
      
      // Analyze recipes for prep opportunities
      for (const day of mealPlan.plan_data.days) {
        for (const meal of day.meals) {
          const { data: recipe, error } = await this.supabase
            .from('recipes')
            .select('id, title, ingredients, instructions, prep_time_minutes')
            .eq('id', meal.recipe_id)
            .single();
            
          if (error || !recipe) continue;
          
          // Look for common prep tasks
          const recipePrepTasks = this.identifyPrepTasks(recipe, day.day);
          
          for (const task of recipePrepTasks) {
            const taskKey = `${task.description}_${task.suggested_day}`;
            
            if (!processedIngredients.has(taskKey)) {
              prepTasks.push(task);
              processedIngredients.add(taskKey);
            } else {
              // Merge with existing task
              const existingTask = prepTasks.find(t => 
                t.description === task.description && t.suggested_day === task.suggested_day
              );
              if (existingTask) {
                existingTask.enables_recipes = [...new Set([...existingTask.enables_recipes, ...task.enables_recipes])];
              }
            }
          }
        }
      }
      
      // Sort by priority and estimated time
      prepTasks.sort((a, b) => {
        const priorityOrder = { high: 3, medium: 2, low: 1 };
        const priorityDiff = priorityOrder[b.priority] - priorityOrder[a.priority];
        if (priorityDiff !== 0) return priorityDiff;
        return b.estimated_time_minutes - a.estimated_time_minutes;
      });
      
      const prepSchedule: PrepSchedule = {
        meal_plan_id: mealPlan.id,
        tasks: prepTasks,
        total_prep_time_minutes: prepTasks.reduce((sum, task) => sum + task.estimated_time_minutes, 0),
        recommended_prep_days: ['sunday', 'wednesday'], // Common prep days
        created_at: new Date()
      };
      
      return prepSchedule;
      
    } catch (error) {
      console.error('Error generating prep schedule:', error);
      return null;
    }
  }

  /**
   * Generate XP challenges based on the meal plan
   */
  private async generateXPChallenges(
    mealPlan: MealPlan,
    context: GenerationContext
  ): Promise<XPChallenge[]> {
    try {
      const challenges: XPChallenge[] = [];
      const userStreak = context.user_blueprint.profile.streak_days;
      
      // Plan completion challenge
      challenges.push({
        id: uuidv4(),
        type: 'plan_completion',
        title: 'Weekly Warrior',
        description: 'Complete all 7 days of your meal plan',
        xp_reward: 150,
        target_value: 7,
        current_progress: 0,
        completed: false,
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 1 week
      });
      
      // Streak maintenance (if user has existing streak)
      if (userStreak >= 3) {
        challenges.push({
          id: uuidv4(),
          type: 'streak_maintenance',
          title: 'Streak Keeper',
          description: `Maintain your ${userStreak}-day streak`,
          xp_reward: Math.min(userStreak * 10, 200),
          target_value: userStreak + 7,
          current_progress: userStreak,
          completed: false,
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
        });
      }
      
      // Recipe rating challenge
      challenges.push({
        id: uuidv4(),
        type: 'recipe_rating',
        title: 'Food Critic',
        description: 'Rate 5 meals this week',
        xp_reward: 75,
        target_value: 5,
        current_progress: 0,
        completed: false,
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      });
      
      // Prep efficiency challenge (if plan has prep tasks)
      const hasPrepTasks = mealPlan.plan_data.wow_layers?.prep_schedule?.tasks.length > 0;
      if (hasPrepTasks) {
        challenges.push({
          id: uuidv4(),
          type: 'prep_efficiency',
          title: 'Prep Master',
          description: 'Complete 3 prep-ahead tasks',
          xp_reward: 100,
          target_value: 3,
          current_progress: 0,
          completed: false,
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
        });
      }
      
      // Variety exploration (if plan has diverse cuisines)
      const uniqueCuisines = new Set();
      for (const day of mealPlan.plan_data.days) {
        for (const meal of day.meals) {
          const { data: recipe } = await this.supabase
            .from('recipes')
            .select('cuisine_type')
            .eq('id', meal.recipe_id)
            .single();
          if (recipe?.cuisine_type) {
            uniqueCuisines.add(recipe.cuisine_type);
          }
        }
      }
      
      if (uniqueCuisines.size >= 3) {
        challenges.push({
          id: uuidv4(),
          type: 'variety_exploration',
          title: 'Global Explorer',
          description: `Try ${uniqueCuisines.size} different cuisines this week`,
          xp_reward: uniqueCuisines.size * 25,
          target_value: uniqueCuisines.size,
          current_progress: 0,
          completed: false,
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
        });
      }
      
      return challenges;
      
    } catch (error) {
      console.error('Error generating XP challenges:', error);
      return [];
    }
  }

  /**
   * Generate cooking tips for recipes
   */
  private async generateCookingTips(
    mealPlan: MealPlan,
    context: GenerationContext
  ): Promise<CookingTip[]> {
    try {
      const tips: CookingTip[] = [];
      const userSkill = context.user_blueprint.intake.cooking_skill_level;
      
      // Generate tips based on user skill level and recipes
      for (const day of mealPlan.plan_data.days) {
        for (const meal of day.meals) {
          const { data: recipe } = await this.supabase
            .from('recipes')
            .select('id, title, difficulty_level, ingredients, instructions')
            .eq('id', meal.recipe_id)
            .single();
            
          if (!recipe) continue;
          
          // Generate contextual tips
          const recipeTips = this.generateRecipeTips(recipe, userSkill);
          tips.push(...recipeTips);
        }
      }
      
      // Limit to most relevant tips
      return tips.slice(0, 5);
      
    } catch (error) {
      console.error('Error generating cooking tips:', error);
      return [];
    }
  }

  // Helper methods
  private normalizeIngredientName(name: string): string {
    return name.toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private categorizeIngredient(name: string): GroceryCategory {
    const categories: { [key: string]: GroceryCategory } = {
      // Produce
      'onion': 'produce', 'garlic': 'produce', 'tomato': 'produce', 'lettuce': 'produce',
      'carrot': 'produce', 'potato': 'produce', 'bell pepper': 'produce', 'spinach': 'produce',
      'apple': 'produce', 'banana': 'produce', 'lemon': 'produce', 'lime': 'produce',
      
      // Meat & Seafood
      'chicken': 'meat_seafood', 'beef': 'meat_seafood', 'pork': 'meat_seafood', 'fish': 'meat_seafood',
      'salmon': 'meat_seafood', 'shrimp': 'meat_seafood', 'turkey': 'meat_seafood',
      
      // Dairy & Eggs
      'milk': 'dairy_eggs', 'cheese': 'dairy_eggs', 'butter': 'dairy_eggs', 'egg': 'dairy_eggs',
      'yogurt': 'dairy_eggs', 'cream': 'dairy_eggs',
      
      // Pantry
      'rice': 'pantry', 'pasta': 'pantry', 'flour': 'pantry', 'sugar': 'pantry',
      'oil': 'pantry', 'vinegar': 'pantry', 'beans': 'pantry', 'lentils': 'pantry',
      
      // Spices & Condiments
      'salt': 'spices', 'pepper': 'spices', 'garlic powder': 'spices', 'paprika': 'spices',
      'soy sauce': 'condiments', 'olive oil': 'condiments', 'ketchup': 'condiments'
    };
    
    const normalized = name.toLowerCase();
    
    for (const [ingredient, category] of Object.entries(categories)) {
      if (normalized.includes(ingredient)) {
        return category;
      }
    }
    
    // Default categorization logic
    if (normalized.includes('cheese') || normalized.includes('milk') || normalized.includes('butter')) {
      return 'dairy_eggs';
    }
    if (normalized.includes('chicken') || normalized.includes('beef') || normalized.includes('fish')) {
      return 'meat_seafood';
    }
    if (normalized.includes('oil') || normalized.includes('sauce') || normalized.includes('dressing')) {
      return 'condiments';
    }
    
    return 'pantry'; // Default fallback
  }

  private identifyPrepTasks(recipe: any, mealDay: string): PrepTask[] {
    const tasks: PrepTask[] = [];
    const ingredients = recipe.ingredients || [];
    
    // Look for common prep opportunities
    const grains = ingredients.filter((ing: any) => 
      ing.name.toLowerCase().includes('rice') || 
      ing.name.toLowerCase().includes('quinoa') ||
      ing.name.toLowerCase().includes('pasta')
    );
    
    if (grains.length > 0) {
      tasks.push({
        id: uuidv4(),
        description: `Cook ${grains.map((g: any) => g.name).join(', ')} in bulk`,
        estimated_time_minutes: 25,
        suggested_day: 'sunday',
        priority: 'medium',
        enables_recipes: [recipe.id],
        requires_equipment: ['pot', 'stove'],
        storage_instructions: 'Store in refrigerator for up to 5 days'
      });
    }
    
    // Vegetable prep
    const vegetables = ingredients.filter((ing: any) => {
      const name = ing.name.toLowerCase();
      return name.includes('onion') || name.includes('pepper') || name.includes('carrot');
    });
    
    if (vegetables.length >= 2) {
      tasks.push({
        id: uuidv4(),
        description: 'Chop vegetables for the week',
        estimated_time_minutes: 15,
        suggested_day: 'sunday',
        priority: 'high',
        enables_recipes: [recipe.id],
        requires_equipment: ['knife', 'cutting board'],
        storage_instructions: 'Store chopped vegetables in airtight containers'
      });
    }
    
    return tasks;
  }

  private generateRecipeTips(recipe: any, userSkill: string): CookingTip[] {
    const tips: CookingTip[] = [];
    const recipeId = recipe.id;
    
    // Skill-based tips
    if (userSkill === 'beginner') {
      if (recipe.difficulty_level === 'medium' || recipe.difficulty_level === 'hard') {
        tips.push({
          id: uuidv4(),
          recipe_id: recipeId,
          tip: 'Read through the entire recipe before starting and prep all ingredients first',
          category: 'technique',
          difficulty_level: 'beginner'
        });
      }
    }
    
    // Ingredient-specific tips
    const hasGarlic = recipe.ingredients?.some((ing: any) => ing.name.toLowerCase().includes('garlic'));
    if (hasGarlic) {
      tips.push({
        id: uuidv4(),
        recipe_id: recipeId,
        tip: 'Crush garlic with the flat side of your knife before mincing for easier prep',
        category: 'efficiency',
        difficulty_level: 'beginner'
      });
    }
    
    return tips;
  }
}