/**
 * End-to-End Test Script for Meal Plan Generation
 * 
 * Tests the complete meal plan generation flow with various user profiles.
 * Useful for validation and debugging.
 * 
 * Usage: node scripts/test-generation.js
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { v4 as uuidv4 } from 'uuid';

// Load environment variables
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

class PlanGenerationTester {
  constructor() {
    this.testUsers = this.createTestUsers();
    this.results = [];
  }

  async runAllTests() {
    console.log('🧪 Starting end-to-end meal plan generation tests...');
    
    for (const [testName, userData] of Object.entries(this.testUsers)) {
      console.log(`\n🎯 Testing: ${testName}`);
      
      try {
        const result = await this.testUserPlanGeneration(testName, userData);
        this.results.push(result);
        
        if (result.success) {
          console.log(`✅ ${testName}: SUCCESS`);
          console.log(`   📊 Generated in ${result.duration_ms}ms`);
          console.log(`   🍽️ ${result.total_recipes} recipes, ${result.unique_recipes} unique`);
          console.log(`   💰 Cost: ${result.cost_cents}¢`);
        } else {
          console.log(`❌ ${testName}: FAILED`);
          console.log(`   Error: ${result.error}`);
        }
      } catch (error) {
        console.log(`💥 ${testName}: CRASHED`);
        console.log(`   Error: ${error.message}`);
        this.results.push({
          test_name: testName,
          success: false,
          error: error.message,
          duration_ms: 0
        });
      }
    }
    
    this.printSummary();
  }

  async testUserPlanGeneration(testName, userData) {
    const startTime = Date.now();
    
    try {
      // 1. Create test user and profile
      const userId = await this.createTestUser(userData);
      
      // 2. Call plan generation function
      const planResult = await this.callPlanGenerator(userId);
      
      // 3. Validate the generated plan
      const validation = await this.validateGeneratedPlan(planResult.plan_id);
      
      // 4. Cleanup test data
      await this.cleanupTestUser(userId);
      
      return {
        test_name: testName,
        success: true,
        duration_ms: Date.now() - startTime,
        generation_id: planResult.generation_id,
        plan_id: planResult.plan_id,
        total_recipes: validation.total_recipes,
        unique_recipes: validation.unique_recipes,
        nutrition_valid: validation.nutrition_valid,
        cost_cents: planResult.cost_cents || 0
      };
      
    } catch (error) {
      return {
        test_name: testName,
        success: false,
        error: error.message,
        duration_ms: Date.now() - startTime
      };
    }
  }

  async createTestUser(userData) {
    const userId = uuidv4();
    
    // Create user profile
    const { error: userError } = await supabase
      .from('users')
      .insert({
        id: userId,
        email: `test-${userId}@mealwise.test`,
        full_name: userData.profile.full_name,
        date_of_birth: userData.profile.date_of_birth,
        height_cm: userData.profile.height_cm,
        weight_kg: userData.profile.weight_kg,
        activity_level: userData.profile.activity_level,
        current_xp: 0,
        current_level: 1,
        streak_days: 0
      });
    
    if (userError) throw new Error(`User creation failed: ${userError.message}`);
    
    // Create user intake
    const { error: intakeError } = await supabase
      .from('user_intake')
      .insert({
        user_id: userId,
        ...userData.intake,
        version: 1,
        is_active: true
      });
    
    if (intakeError) throw new Error(`Intake creation failed: ${intakeError.message}`);
    
    // Create subscription
    const { error: subError } = await supabase
      .from('subscriptions')
      .insert({
        user_id: userId,
        plan_id: userData.subscription.plan_id,
        status: 'active',
        current_period_start: new Date().toISOString(),
        current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() // 30 days
      });
    
    if (subError) throw new Error(`Subscription creation failed: ${subError.message}`);
    
    return userId;
  }

  async callPlanGenerator(userId) {
    // Simulate calling the plan generator function
    const response = await fetch(`${process.env.SUPABASE_URL}/functions/v1/plan-generator`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        week_start_date: this.getNextMonday().toISOString(),
        force_regenerate: true
      })
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Plan generation failed: ${response.status} ${errorText}`);
    }
    
    return await response.json();
  }

  async validateGeneratedPlan(planId) {
    if (!planId) {
      throw new Error('No plan ID returned from generation');
    }
    
    const { data: plan, error } = await supabase
      .from('meal_plans')
      .select('*')
      .eq('id', planId)
      .single();
    
    if (error || !plan) {
      throw new Error('Generated plan not found in database');
    }
    
    // Validate plan structure
    if (!plan.plan_data || !plan.plan_data.days) {
      throw new Error('Invalid plan structure - missing days');
    }
    
    const totalRecipes = plan.plan_data.total_recipes || 0;
    const uniqueRecipes = plan.plan_data.unique_recipes || 0;
    
    // Basic validation checks
    if (totalRecipes === 0) {
      throw new Error('Plan has no recipes');
    }
    
    if (plan.plan_data.days.length !== 7) {
      throw new Error(`Expected 7 days, got ${plan.plan_data.days.length}`);
    }
    
    // Check that each day has meals
    for (const day of plan.plan_data.days) {
      if (!day.meals || day.meals.length === 0) {
        throw new Error(`Day ${day.day} has no meals`);
      }
    }
    
    return {
      total_recipes: totalRecipes,
      unique_recipes: uniqueRecipes,
      nutrition_valid: true, // Would implement nutrition validation here
      plan_structure_valid: true
    };
  }

  async cleanupTestUser(userId) {
    try {
      // Delete in reverse order of dependencies
      await supabase.from('meal_plans').delete().eq('user_id', userId);
      await supabase.from('subscriptions').delete().eq('user_id', userId);
      await supabase.from('user_intake').delete().eq('user_id', userId);
      await supabase.from('users').delete().eq('id', userId);
    } catch (error) {
      console.warn(`Warning: Cleanup failed for user ${userId}:`, error.message);
    }
  }

  createTestUsers() {
    return {
      'Keto Beginner': {
        profile: {
          full_name: 'Alice Keto',
          date_of_birth: '1990-05-15',
          height_cm: 165,
          weight_kg: 70,
          activity_level: 'moderate'
        },
        intake: {
          diet_type: 'keto',
          allergies: [],
          dislikes: ['mushrooms'],
          health_goals: ['weight_loss'],
          budget_range: 'medium',
          cooking_time_preference: 30,
          cooking_skill_level: 'beginner',
          household_size: 1,
          kitchen_equipment: ['oven', 'stovetop', 'microwave'],
          flavor_preferences: {
            spicy: 3,
            sweet: 2,
            savory: 8,
            umami: 6,
            bitter: 2,
            sour: 4
          },
          cultural_preferences: ['american']
        },
        subscription: {
          plan_id: 'pro'
        }
      },
      
      'Vegan Athlete': {
        profile: {
          full_name: 'Bob Plant',
          date_of_birth: '1985-08-22',
          height_cm: 180,
          weight_kg: 75,
          activity_level: 'very_active'
        },
        intake: {
          diet_type: 'vegan',
          allergies: ['nuts'],
          dislikes: [],
          health_goals: ['muscle_gain', 'energy_boost'],
          budget_range: 'high',
          cooking_time_preference: 45,
          cooking_skill_level: 'intermediate',
          household_size: 2,
          kitchen_equipment: ['oven', 'stovetop', 'blender', 'food_processor'],
          flavor_preferences: {
            spicy: 7,
            sweet: 4,
            savory: 8,
            umami: 9,
            bitter: 5,
            sour: 6
          },
          cultural_preferences: ['mediterranean', 'asian']
        },
        subscription: {
          plan_id: 'family'
        }
      },
      
      'Busy Family': {
        profile: {
          full_name: 'Carol Family',
          date_of_birth: '1982-12-03',
          height_cm: 168,
          weight_kg: 65,
          activity_level: 'light'
        },
        intake: {
          diet_type: 'omnivore',
          allergies: ['shellfish'],
          dislikes: ['liver', 'organ_meat'],
          health_goals: ['maintenance'],
          budget_range: 'medium',
          cooking_time_preference: 20,
          cooking_skill_level: 'intermediate',
          household_size: 4,
          kitchen_equipment: ['oven', 'stovetop', 'microwave', 'slow_cooker'],
          flavor_preferences: {
            spicy: 4,
            sweet: 6,
            savory: 7,
            umami: 5,
            bitter: 3,
            sour: 4
          },
          cultural_preferences: ['american', 'italian']
        },
        subscription: {
          plan_id: 'family'
        }
      },
      
      'PCOS Health Focus': {
        profile: {
          full_name: 'Diana Health',
          date_of_birth: '1993-03-18',
          height_cm: 162,
          weight_kg: 68,
          activity_level: 'moderate'
        },
        intake: {
          diet_type: 'pcos',
          allergies: ['dairy'],
          dislikes: ['cilantro'],
          health_goals: ['weight_loss', 'digestive_health'],
          budget_range: 'medium',
          cooking_time_preference: 35,
          cooking_skill_level: 'advanced',
          household_size: 1,
          kitchen_equipment: ['oven', 'stovetop', 'air_fryer', 'instant_pot'],
          flavor_preferences: {
            spicy: 6,
            sweet: 3,
            savory: 8,
            umami: 7,
            bitter: 4,
            sour: 5
          },
          cultural_preferences: ['mediterranean', 'middle_eastern']
        },
        subscription: {
          plan_id: 'pro'
        }
      }
    };
  }

  getNextMonday() {
    const today = new Date();
    const dayOfWeek = today.getDay();
    const daysUntilMonday = dayOfWeek === 0 ? 1 : 8 - dayOfWeek;
    const nextMonday = new Date(today);
    nextMonday.setDate(today.getDate() + daysUntilMonday);
    nextMonday.setHours(0, 0, 0, 0);
    return nextMonday;
  }

  printSummary() {
    console.log('\n📊 TEST SUMMARY');
    console.log('================');
    
    const totalTests = this.results.length;
    const successfulTests = this.results.filter(r => r.success).length;
    const failedTests = totalTests - successfulTests;
    
    console.log(`Total Tests: ${totalTests}`);
    console.log(`✅ Successful: ${successfulTests}`);
    console.log(`❌ Failed: ${failedTests}`);
    console.log(`📈 Success Rate: ${(successfulTests / totalTests * 100).toFixed(1)}%`);
    
    if (successfulTests > 0) {
      const avgDuration = this.results
        .filter(r => r.success)
        .reduce((sum, r) => sum + r.duration_ms, 0) / successfulTests;
      
      const avgCost = this.results
        .filter(r => r.success && r.cost_cents)
        .reduce((sum, r) => sum + r.cost_cents, 0) / successfulTests;
      
      console.log(`⏱️ Avg Duration: ${Math.round(avgDuration)}ms`);
      if (avgCost > 0) {
        console.log(`💰 Avg Cost: ${avgCost.toFixed(2)}¢`);
      }
    }
    
    // Print failed test details
    const failedResults = this.results.filter(r => !r.success);
    if (failedResults.length > 0) {
      console.log('\n❌ FAILED TESTS:');
      failedResults.forEach(result => {
        console.log(`   ${result.test_name}: ${result.error}`);
      });
    }
    
    console.log('\n🎯 Test completed!');
  }
}

// Run tests if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const tester = new PlanGenerationTester();
  tester.runAllTests().catch(console.error);
}

export default PlanGenerationTester;