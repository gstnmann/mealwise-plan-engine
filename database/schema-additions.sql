-- =============================================================================
-- MEALWISE PLAN GENERATION ENGINE - DATABASE SCHEMA ADDITIONS
-- =============================================================================
-- This file contains additional tables and functions needed for the meal plan
-- generation engine that aren't in the main Mealwise schema.

-- =============================================================================
-- USDA NUTRITION DATABASE (Internal Cache)
-- =============================================================================

-- Table to store USDA FoodData Central nutrition information
-- This replaces real-time API calls for speed and reliability
CREATE TABLE IF NOT EXISTS public.usda_nutrition_data (
  fdc_id INTEGER PRIMARY KEY,
  description TEXT NOT NULL,
  
  -- Core macronutrients (per 100g)
  calories REAL,
  protein REAL,
  fat REAL,
  carbohydrates REAL,
  fiber REAL,
  sugar REAL,
  
  -- Additional nutrients (optional, stored as JSONB for flexibility)
  nutrients JSONB DEFAULT '{}',
  
  -- Data source tracking
  data_type TEXT, -- 'foundation', 'sr_legacy', etc.
  publication_date DATE,
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for fast searching
CREATE INDEX IF NOT EXISTS idx_usda_description_search 
  ON public.usda_nutrition_data 
  USING gin(to_tsvector('english', description));

CREATE INDEX IF NOT EXISTS idx_usda_description_trigram 
  ON public.usda_nutrition_data 
  USING gin(description gin_trgm_ops);

-- =============================================================================
-- PLAN GENERATION TRACKING
-- =============================================================================

-- Table to track plan generation attempts and performance
CREATE TABLE IF NOT EXISTS public.plan_generation_logs (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
  
  -- Generation metadata
  generation_id UUID UNIQUE NOT NULL, -- Unique ID for this generation attempt
  status TEXT NOT NULL CHECK (status IN ('started', 'completed', 'failed', 'fallback')),
  
  -- Performance tracking
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER,
  
  -- AI usage tracking
  claude_requests INTEGER DEFAULT 0,
  claude_tokens_used INTEGER DEFAULT 0,
  claude_cost_cents INTEGER DEFAULT 0,
  
  -- Generation details
  retry_count INTEGER DEFAULT 0,
  error_message TEXT,
  fallback_reason TEXT,
  
  -- Plan characteristics
  recipes_selected INTEGER,
  nutritional_accuracy JSONB, -- { "calories_deviation": 5.2, "protein_deviation": -3.1 }
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for performance queries
CREATE INDEX IF NOT EXISTS idx_plan_logs_user_date 
  ON public.plan_generation_logs(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_plan_logs_status 
  ON public.plan_generation_logs(status);

-- =============================================================================
-- FAILED PLANS TRACKING (For AI Improvement)
-- =============================================================================

-- Table to store failed plan attempts for analysis and improvement
CREATE TABLE IF NOT EXISTS public.failed_plans (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
  generation_id UUID NOT NULL,
  
  -- Failure details
  failure_stage TEXT NOT NULL, -- 'candidate_selection', 'nutrition_validation', 'coherence_review'
  failure_reason TEXT NOT NULL,
  
  -- Context for debugging
  user_blueprint JSONB NOT NULL, -- Complete user profile at time of failure
  attempted_recipes JSONB, -- Recipes that were attempted
  validation_results JSONB, -- Results from nutrition council
  
  -- AI prompt and response (for improvement)
  prompt_used TEXT,
  ai_response TEXT,
  
  -- Status tracking
  reviewed BOOLEAN DEFAULT FALSE,
  resolved BOOLEAN DEFAULT FALSE,
  resolution_notes TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- MOOD JAM ASSIGNMENTS
-- =============================================================================

-- Table to store mood-to-playlist mappings
CREATE TABLE IF NOT EXISTS public.mood_jam_assignments (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  meal_plan_id UUID REFERENCES public.meal_plans(id) ON DELETE CASCADE NOT NULL,
  
  -- Mood analysis
  detected_mood TEXT NOT NULL, -- 'focus', 'comfort', 'energy', 'family', etc.
  mood_confidence REAL DEFAULT 0, -- 0-1 confidence score
  
  -- Spotify integration
  spotify_playlist_id TEXT,
  spotify_playlist_url TEXT,
  playlist_name TEXT,
  
  -- Playlist characteristics
  genres TEXT[] DEFAULT '{}',
  audio_features JSONB, -- Spotify audio features like energy, valence, etc.
  
  -- Performance tracking
  user_rating INTEGER CHECK (user_rating >= 1 AND user_rating <= 5),
  play_count INTEGER DEFAULT 0,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- SMART GROCERY LISTS
-- =============================================================================

-- Table to store generated grocery lists
CREATE TABLE IF NOT EXISTS public.grocery_lists (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  meal_plan_id UUID REFERENCES public.meal_plans(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
  
  -- List content
  items JSONB NOT NULL, -- Structured grocery list by category
  total_estimated_cost DECIMAL(10,2),
  
  -- External integration
  instacart_cart_id TEXT, -- For future Instacart integration
  
  -- User interaction
  items_checked_off JSONB DEFAULT '{}', -- Track what user has obtained
  completion_percentage DECIMAL(5,2) DEFAULT 0,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- DATABASE FUNCTIONS
-- =============================================================================

-- Function to search USDA nutrition data with fuzzy matching
CREATE OR REPLACE FUNCTION search_nutrition_data(
  ingredient_name TEXT,
  max_results INTEGER DEFAULT 1
)
RETURNS TABLE(
  fdc_id INTEGER,
  description TEXT,
  calories REAL,
  protein REAL,
  fat REAL,
  carbohydrates REAL,
  similarity_score REAL
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    u.fdc_id,
    u.description,
    u.calories,
    u.protein,
    u.fat,
    u.carbohydrates,
    similarity(u.description, ingredient_name) as similarity_score
  FROM public.usda_nutrition_data u
  WHERE 
    u.description % ingredient_name  -- Use trigram similarity
    OR to_tsvector('english', u.description) @@ plainto_tsquery('english', ingredient_name)
  ORDER BY 
    similarity(u.description, ingredient_name) DESC,
    ts_rank(to_tsvector('english', u.description), plainto_tsquery('english', ingredient_name)) DESC
  LIMIT max_results;
END;
$$ LANGUAGE plpgsql;

-- Function to calculate nutritional totals for a meal plan
CREATE OR REPLACE FUNCTION calculate_plan_nutrition(
  plan_data JSONB
)
RETURNS JSONB AS $$
DECLARE
  result JSONB := '{"total_calories": 0, "total_protein": 0, "total_fat": 0, "total_carbs": 0, "days": 0}'::JSONB;
  day_data JSONB;
  meal_data JSONB;
  recipe_nutrition JSONB;
BEGIN
  -- Iterate through each day in the plan
  FOR day_data IN SELECT jsonb_array_elements(plan_data->'days')
  LOOP
    result := jsonb_set(result, '{days}', (result->>'days')::INT + 1);
    
    -- Iterate through each meal in the day
    FOR meal_data IN SELECT jsonb_array_elements(day_data->'meals')
    LOOP
      -- Get nutrition info for this recipe
      SELECT nutrition_info INTO recipe_nutrition
      FROM public.recipes
      WHERE id = (meal_data->>'recipe_id')::UUID;
      
      IF recipe_nutrition IS NOT NULL THEN
        result := jsonb_set(result, '{total_calories}', 
          ((result->>'total_calories')::REAL + (recipe_nutrition->>'calories')::REAL)::TEXT::JSONB);
        result := jsonb_set(result, '{total_protein}', 
          ((result->>'total_protein')::REAL + (recipe_nutrition->>'protein')::REAL)::TEXT::JSONB);
        result := jsonb_set(result, '{total_fat}', 
          ((result->>'total_fat')::REAL + (recipe_nutrition->>'fat')::REAL)::TEXT::JSONB);
        result := jsonb_set(result, '{total_carbs}', 
          ((result->>'total_carbs')::REAL + (recipe_nutrition->>'carbohydrates')::REAL)::TEXT::JSONB);
      END IF;
    END LOOP;
  END LOOP;
  
  -- Calculate daily averages
  IF (result->>'days')::INT > 0 THEN
    result := jsonb_set(result, '{avg_daily_calories}', 
      ((result->>'total_calories')::REAL / (result->>'days')::INT)::TEXT::JSONB);
    result := jsonb_set(result, '{avg_daily_protein}', 
      ((result->>'total_protein')::REAL / (result->>'days')::INT)::TEXT::JSONB);
    result := jsonb_set(result, '{avg_daily_fat}', 
      ((result->>'total_fat')::REAL / (result->>'days')::INT)::TEXT::JSONB);
    result := jsonb_set(result, '{avg_daily_carbs}', 
      ((result->>'total_carbs')::REAL / (result->>'days')::INT)::TEXT::JSONB);
  END IF;
  
  RETURN result;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- TRIGGERS
-- =============================================================================

-- Trigger to update grocery lists when meal plans change
CREATE OR REPLACE FUNCTION update_grocery_list_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_grocery_lists_updated_at
  BEFORE UPDATE ON public.grocery_lists
  FOR EACH ROW
  EXECUTE FUNCTION update_grocery_list_timestamp();

-- =============================================================================
-- VIEWS FOR ANALYTICS
-- =============================================================================

-- View for plan generation performance analytics
CREATE OR REPLACE VIEW public.plan_generation_analytics AS
SELECT 
  DATE_TRUNC('day', created_at) as date,
  COUNT(*) as total_attempts,
  COUNT(*) FILTER (WHERE status = 'completed') as successful_plans,
  COUNT(*) FILTER (WHERE status = 'failed') as failed_plans,
  COUNT(*) FILTER (WHERE status = 'fallback') as fallback_plans,
  AVG(duration_ms) as avg_duration_ms,
  AVG(claude_tokens_used) as avg_tokens_used,
  AVG(claude_cost_cents) as avg_cost_cents,
  AVG(retry_count) as avg_retries
FROM public.plan_generation_logs
GROUP BY DATE_TRUNC('day', created_at)
ORDER BY date DESC;

-- View for nutritional accuracy tracking
CREATE OR REPLACE VIEW public.nutrition_accuracy_stats AS
SELECT 
  DATE_TRUNC('week', created_at) as week,
  COUNT(*) as plans_generated,
  AVG((nutritional_accuracy->>'calories_deviation')::REAL) as avg_calories_deviation,
  AVG((nutritional_accuracy->>'protein_deviation')::REAL) as avg_protein_deviation,
  AVG((nutritional_accuracy->>'fat_deviation')::REAL) as avg_fat_deviation,
  AVG((nutritional_accuracy->>'carbohydrates_deviation')::REAL) as avg_carbs_deviation,
  COUNT(*) FILTER (WHERE 
    ABS((nutritional_accuracy->>'calories_deviation')::REAL) <= 15 AND
    ABS((nutritional_accuracy->>'protein_deviation')::REAL) <= 15 AND
    ABS((nutritional_accuracy->>'fat_deviation')::REAL) <= 15 AND
    ABS((nutritional_accuracy->>'carbohydrates_deviation')::REAL) <= 15
  ) as plans_within_15_percent
FROM public.plan_generation_logs
WHERE nutritional_accuracy IS NOT NULL
GROUP BY DATE_TRUNC('week', created_at)
ORDER BY week DESC;

COMMENT ON SCHEMA public IS 'Mealwise Plan Generation Engine - Enhanced with nutrition validation, mood integration, and performance tracking';