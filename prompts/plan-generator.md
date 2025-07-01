# Mealwise Plan Generator - Claude Prompts

This document contains the structured prompts used by the Mealwise Plan Generation Engine for various AI operations.

## Recipe Scoring Prompt

```markdown
You are an expert meal planning AI that scores recipes for personalization.

<user_profile>
{user_profile_json}
</user_profile>

<recipes_to_score>
{recipes_json}
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
    }
  }
}
</scoring_instructions>
```

## Meal Plan Assembly Prompt

```markdown
You are creating a balanced weekly meal plan. Assign recipes to specific meal slots to create variety and balance.

<available_recipes>
{recipes_json}
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
  ]
}
```

## Coherence Review Prompt

```markdown
Review this meal plan for taste, texture, and variety coherence.

<meal_plan>
{plan_summary_json}
</meal_plan>

<user_context>
Diet: {diet_type}
Cooking skill: {cooking_skill_level}
Cultural preferences: {cultural_preferences}
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
}
```

## Mood Analysis Prompt

```markdown
Analyze the mood and vibe of this meal plan to assign an appropriate music playlist.

<meal_plan>
{plan_summary_json}
</meal_plan>

<user_context>
{user_context_json}
</user_context>

<mood_categories>
- **focus**: Clean, productive vibes for meal prep and mindful eating
- **comfort**: Warm, cozy feelings for hearty, soul-warming meals  
- **energy**: Upbeat, motivating music for active cooking and vibrant meals
- **family**: Warm, inclusive vibes for shared meals and bonding
- **adventure**: Exciting, exploratory music for trying new cuisines
- **zen**: Calming, peaceful music for healthy, balanced eating
</mood_categories>

<audio_features_guide>
- **energy**: 0.1 (calm) to 0.9 (high energy)
- **valence**: 0.1 (sad/negative) to 0.9 (happy/positive)  
- **acousticness**: 0.1 (electronic) to 0.9 (acoustic)
- **danceability**: 0.1 (not danceable) to 0.9 (very danceable)
</audio_features_guide>

Analyze the meal plan's overall vibe considering:
1. Cuisine diversity and adventure level
2. Cooking complexity and time investment
3. Health focus vs comfort food balance
4. User's lifestyle and preferences

Return ONLY JSON:
{
  "mood": "focus",
  "confidence": 0.85,
  "explanation": "This plan emphasizes healthy, efficient meals perfect for focused weekday eating...",
  "genres": ["ambient", "electronic", "chill"],
  "audio_features": {
    "energy": 0.4,
    "valence": 0.7,
    "acousticness": 0.3,
    "danceability": 0.5
  }
}
```

## Prompt Guidelines

### Best Practices

1. **Structure**: Always use clear XML-style tags for different sections
2. **Output Format**: Explicitly specify JSON output format and structure
3. **Context**: Provide relevant user context without overwhelming detail
4. **Constraints**: Clearly state scoring criteria and rules
5. **Examples**: Include specific examples when helpful

### Token Management

- **Input Optimization**: Keep prompts under 4000 tokens when possible
- **Output Limits**: Set appropriate max_tokens (500-3000 based on task)
- **Context Compression**: Summarize large datasets before including

### Temperature Settings

- **Recipe Scoring**: 0.3 (consistent, analytical)
- **Meal Assembly**: 0.3 (structured, logical)
- **Coherence Review**: 0.2 (objective assessment)
- **Mood Analysis**: 0.4 (creative interpretation)

### Error Handling

```markdown
If you cannot complete this task due to insufficient information, respond with:
{
  "error": "INSUFFICIENT_DATA",
  "message": "Specific reason for inability to complete",
  "required_fields": ["list", "of", "missing", "data"]
}
```

### Validation Patterns

```typescript
// Prompt response validation
function validatePromptResponse(response: string, expectedFields: string[]) {
  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in response');
    }
    
    const parsed = JSON.parse(jsonMatch[0]);
    
    for (const field of expectedFields) {
      if (!(field in parsed)) {
        throw new Error(`Missing required field: ${field}`);
      }
    }
    
    return { success: true, data: parsed };
  } catch (error) {
    return { success: false, error: error.message };
  }
}
```