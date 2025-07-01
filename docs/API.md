# Mealwise Plan Generation Engine API Documentation

## Overview

The Mealwise Plan Generation Engine provides a robust API for creating personalized, nutritionally validated meal plans. This document covers all endpoints, request/response formats, and integration patterns.

## Base URL

```
https://your-supabase-project.supabase.co/functions/v1/
```

## Authentication

All API endpoints require authentication via Supabase Auth. Include the user's JWT token in the Authorization header:

```
Authorization: Bearer <jwt_token>
```

## Endpoints

### Generate Meal Plan

**Endpoint:** `POST /plan-generator`

**Description:** Generates a personalized weekly meal plan for the authenticated user.

**Request Body:**
```json
{
  "week_start_date": "2024-01-15" // Optional, defaults to next Monday
  "special_requests": ["low sodium", "extra protein"], // Optional
  "force_regenerate": false, // Optional, ignore existing plans for this week
  "preferences": {
    "enforce_variety": true, // Optional, default true
    "max_prep_time": 30, // Optional, override user preference
    "focus_macros": ["protein"], // Optional: "protein", "carbs", "fat"
    "mood_override": "energy", // Optional, force specific mood
    "exclude_recipes": ["recipe-uuid-1"] // Optional, temporarily exclude recipes
  }
}
```

**Success Response (200):**
```json
{
  "success": true,
  "generation_id": "uuid",
  "plan_id": "uuid",
  "status": "generated", // or "generated_with_fallback"
  "message": "Your personalized meal plan is ready!",
  "duration_ms": 8543,
  "total_recipes": 21,
  "week_theme": "Mediterranean Wellness Week"
}
```

**Fallback Response (200):**
```json
{
  "success": true,
  "generation_id": "uuid",
  "plan_id": "uuid",
  "status": "generated_with_fallback",
  "message": "We've created a starter plan for you! Our AI council is performing a deeper review to perfect your next plan.",
  "duration_ms": 12000,
  "total_recipes": 9,
  "week_theme": "Getting Started"
}
```

**Error Responses:**

```json
// 401 Unauthorized
{
  "success": false,
  "error": "Unauthorized: Invalid or missing authentication",
  "status": 401
}

// 403 Forbidden
{
  "success": false,
  "error": "No active subscription found",
  "status": 403
}

// 422 Unprocessable Entity
{
  "success": false,
  "error": "Invalid request format: week_start_date must be a valid date",
  "status": 422
}

// 429 Too Many Requests
{
  "success": false,
  "error": "Monthly plan generation limit reached (5 plans)",
  "status": 429
}

// 500 Internal Server Error
{
  "success": false,
  "error": "Generation failed after 3 attempts: Nutritional validation failed",
  "status": 500,
  "generation_id": "uuid",
  "error_details": {
    "code": "NUTRITION_VALIDATION_FAILED",
    "stage": "nutrition_validation",
    "message": "Unable to meet macro targets within 15% threshold"
  }
}
```

### AI Gateway

**Endpoint:** `POST /ai-gateway`

**Description:** Secure gateway for all AI requests with validation and rate limiting.

**Request Body:**
```json
{
  "model": "claude-3-5-sonnet",
  "prompt": "Your prompt here",
  "max_tokens": 1000,
  "temperature": 0.3,
  "context": {
    "user_id": "uuid",
    "operation": "recipe_scoring"
  }
}
```

**Success Response (200):**
```json
{
  "success": true,
  "response": "AI response text",
  "tokens_used": 856,
  "cost_cents": 4,
  "model": "claude-3-5-sonnet",
  "cached": false
}
```

### Nutrition Validator

**Endpoint:** `POST /nutrition-validator`

**Description:** Validates meal plans against nutritional targets using internal USDA database.

**Request Body:**
```json
{
  "meal_plan_id": "uuid",
  "target_calories": 2000,
  "target_protein": 150,
  "target_fat": 67,
  "target_carbs": 250
}
```

**Success Response (200):**
```json
{
  "success": true,
  "is_valid": true,
  "daily_average": {
    "calories": 1985,
    "protein": 145,
    "fat": 71,
    "carbohydrates": 248
  },
  "target_deviations": {
    "calories_deviation": -0.75,
    "protein_deviation": -3.33,
    "fat_deviation": 5.97,
    "carbohydrates_deviation": -0.8
  },
  "within_15_percent_threshold": true,
  "suggestions": []
}
```

## Database Schema Integration

### Required Tables

The API integrates with the following Supabase tables:

- `users` - User profiles and gamification data
- `user_intake` - Dietary preferences and constraints
- `subscriptions` - Subscription status and limits
- `recipes` - Recipe database (from Spoonacular)
- `meal_plans` - Generated meal plans
- `usda_nutrition_data` - Internal nutrition database
- `plan_generation_logs` - Performance and error tracking
- `mood_jam_assignments` - Spotify playlist assignments
- `grocery_lists` - Generated shopping lists

### Row Level Security

All data access is protected by Supabase RLS policies:
- Users can only access their own data
- Service role has admin access for generation functions
- Nutrition data is publicly readable for calculations

## Rate Limiting

- **Plan Generation:** Based on subscription tier
  - Free: 1 plan per month
  - Pro: 4 plans per month
  - Family: Unlimited
- **AI Gateway:** 100 requests per user per hour
- **Nutrition Validator:** 1000 requests per user per day

## Error Handling

The API uses consistent error response formats:

```json
{
  "success": false,
  "error": "Human-readable error message",
  "status": 400,
  "error_code": "VALIDATION_FAILED", // Optional
  "details": {} // Optional additional context
}
```

### Common Error Codes

- `UNAUTHORIZED` - Invalid or missing authentication
- `SUBSCRIPTION_REQUIRED` - No active subscription
- `RATE_LIMITED` - Too many requests
- `VALIDATION_FAILED` - Input validation error
- `GENERATION_FAILED` - Plan generation error
- `NUTRITION_VALIDATION_FAILED` - Nutritional targets not met
- `AI_SERVICE_ERROR` - Claude API error
- `DATABASE_ERROR` - Supabase database error

## Performance Considerations

### Response Times
- **Plan Generation:** 5-15 seconds (synchronous)
- **AI Gateway:** 1-5 seconds
- **Nutrition Validator:** <1 second

### Cost Tracking
All AI requests include cost tracking in cents:
```json
{
  "claude_requests": 3,
  "claude_tokens_used": 2847,
  "claude_cost_cents": 12
}
```

## Integration Examples

### JavaScript/TypeScript

```typescript
interface GeneratePlanRequest {
  week_start_date?: string;
  special_requests?: string[];
  force_regenerate?: boolean;
  preferences?: {
    enforce_variety?: boolean;
    max_prep_time?: number;
    focus_macros?: ('protein' | 'carbs' | 'fat')[];
    mood_override?: string;
    exclude_recipes?: string[];
  };
}

async function generateMealPlan(
  supabaseClient: SupabaseClient,
  request: GeneratePlanRequest
) {
  const { data, error } = await supabaseClient.functions.invoke(
    'plan-generator',
    {
      body: request
    }
  );
  
  if (error) {
    throw new Error(`Plan generation failed: ${error.message}`);
  }
  
  return data;
}
```

### React Hook

```typescript
import { useState } from 'react';
import { useSupabaseClient } from '@supabase/auth-helpers-react';

export function useMealPlanGeneration() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const supabase = useSupabaseClient();
  
  const generatePlan = async (request: GeneratePlanRequest) => {
    setLoading(true);
    setError(null);
    
    try {
      const result = await generateMealPlan(supabase, request);
      return result;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  };
  
  return { generatePlan, loading, error };
}
```

## Monitoring and Analytics

The API automatically logs:
- Generation success/failure rates
- Performance metrics (response times)
- AI usage and costs
- Error patterns and user impact
- Nutritional accuracy statistics

Access analytics via the admin dashboard or direct database queries on the `plan_generation_logs` table.

## Support and Debugging

For debugging failed generations:
1. Check `plan_generation_logs` table for the generation_id
2. Review `failed_plans` table for detailed error context
3. Monitor AI token usage for cost optimization
4. Use the test script: `node scripts/test-generation.js`

## Changelog

### v1.0.0 (2024-01-01)
- Initial release with core plan generation
- Claude 3.5 Sonnet integration
- Internal USDA nutrition validation
- Spotify mood jam assignments
- Comprehensive error handling and logging