/**
 * Blueprint Validation Utilities
 * 
 * Validates user blueprints to ensure they have sufficient data
 * for meal plan generation.
 */

import type { UserBlueprint, BlueprintValidation } from "../../../../types/blueprint.ts";

/**
 * Validates a user blueprint for meal plan generation
 */
export function validateUserBlueprint(blueprint: UserBlueprint): BlueprintValidation {
  const missing: string[] = [];
  const warnings: string[] = [];

  // Check core profile requirements
  if (!blueprint.profile) {
    missing.push('user_profile');
  }

  if (!blueprint.intake) {
    missing.push('user_intake');
  } else {
    // Check essential intake fields
    if (!blueprint.intake.diet_type) {
      missing.push('diet_type');
    }
    
    if (!blueprint.intake.cooking_skill_level) {
      warnings.push('cooking_skill_level_missing');
    }
    
    if (!blueprint.intake.cooking_time_preference) {
      warnings.push('cooking_time_preference_missing');
    }
    
    if (!blueprint.intake.household_size || blueprint.intake.household_size < 1) {
      missing.push('household_size');
    }
  }

  // Check subscription
  if (!blueprint.subscription || blueprint.subscription.status !== 'active') {
    missing.push('active_subscription');
  }

  // Check for nutritional target calculation possibility
  let nutritionalTargetsCalculated = false;
  if (blueprint.profile && blueprint.intake) {
    if (blueprint.profile.weight_kg && blueprint.profile.height_cm && blueprint.profile.date_of_birth) {
      nutritionalTargetsCalculated = true;
    } else {
      warnings.push('insufficient_data_for_nutritional_targets');
    }
  }

  // Check for personalization data
  if (!blueprint.recent_ratings?.length && !blueprint.recent_swaps?.length) {
    warnings.push('limited_personalization_data');
  }

  const isValid = missing.length === 0;
  const canGeneratePlan = isValid && (
    nutritionalTargetsCalculated || 
    blueprint.nutritional_targets // Pre-calculated targets exist
  );

  return {
    is_valid: isValid,
    missing_fields: missing,
    warnings,
    nutritional_targets_calculated: nutritionalTargetsCalculated,
    can_generate_plan: canGeneratePlan
  };
}

/**
 * Validates generation preferences
 */
export function validateGenerationPreferences(preferences: any): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (preferences.max_prep_time && (preferences.max_prep_time < 5 || preferences.max_prep_time > 180)) {
    errors.push('max_prep_time must be between 5 and 180 minutes');
  }

  if (preferences.focus_macros && preferences.focus_macros.length > 2) {
    errors.push('focus_macros can contain at most 2 macronutrients');
  }

  if (preferences.exclude_recipes && preferences.exclude_recipes.length > 50) {
    errors.push('exclude_recipes list cannot exceed 50 items');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Calculates a completeness score for the blueprint (0-100)
 */
export function calculateBlueprintCompleteness(blueprint: UserBlueprint): number {
  let score = 0;
  const maxScore = 100;

  // Core requirements (40 points)
  if (blueprint.profile) score += 10;
  if (blueprint.intake) score += 10;
  if (blueprint.subscription?.status === 'active') score += 10;
  if (blueprint.intake?.diet_type) score += 10;

  // Physical characteristics for nutrition (20 points)
  if (blueprint.profile?.weight_kg) score += 7;
  if (blueprint.profile?.height_cm) score += 7;
  if (blueprint.profile?.date_of_birth) score += 6;

  // Preferences and lifestyle (25 points)
  if (blueprint.intake?.cooking_skill_level) score += 5;
  if (blueprint.intake?.cooking_time_preference) score += 5;
  if (blueprint.intake?.budget_range) score += 5;
  if (blueprint.intake?.flavor_preferences) score += 5;
  if (blueprint.intake?.cultural_preferences?.length) score += 5;

  // Personalization data (15 points)
  if (blueprint.recent_ratings?.length) score += 8;
  if (blueprint.recent_swaps?.length) score += 4;
  if (blueprint.intake?.allergies?.length || blueprint.intake?.dislikes?.length) score += 3;

  return Math.min(score, maxScore);
}

/**
 * Gets user-friendly messages for validation results
 */
export function getBlueprintValidationMessages(validation: BlueprintValidation): {
  missing_messages: string[];
  warning_messages: string[];
  suggestions: string[];
} {
  const missingMessages: string[] = [];
  const warningMessages: string[] = [];
  const suggestions: string[] = [];

  // Convert missing fields to user-friendly messages
  validation.missing_fields.forEach(field => {
    switch (field) {
      case 'user_profile':
        missingMessages.push('Your profile information is incomplete');
        break;
      case 'user_intake':
        missingMessages.push('Please complete your dietary preferences');
        break;
      case 'diet_type':
        missingMessages.push('Please select your dietary preference (vegan, keto, etc.)');
        break;
      case 'household_size':
        missingMessages.push('Please specify how many people you\'re cooking for');
        break;
      case 'active_subscription':
        missingMessages.push('An active subscription is required to generate meal plans');
        break;
      default:
        missingMessages.push(`Missing required field: ${field}`);
    }
  });

  // Convert warnings to user-friendly messages
  validation.warnings.forEach(warning => {
    switch (warning) {
      case 'cooking_skill_level_missing':
        warningMessages.push('Consider adding your cooking skill level for better recipe recommendations');
        suggestions.push('Set your cooking skill level in preferences');
        break;
      case 'cooking_time_preference_missing':
        warningMessages.push('No cooking time preference set - we\'ll assume you prefer quick meals');
        suggestions.push('Set your preferred cooking time in preferences');
        break;
      case 'insufficient_data_for_nutritional_targets':
        warningMessages.push('Add your height, weight, and age for personalized nutrition targets');
        suggestions.push('Complete your profile for better nutritional matching');
        break;
      case 'limited_personalization_data':
        warningMessages.push('Rate some recipes to help us learn your preferences');
        suggestions.push('Try rating meals as you cook them to improve future recommendations');
        break;
    }
  });

  return {
    missing_messages: missingMessages,
    warning_messages: warningMessages,
    suggestions
  };
}