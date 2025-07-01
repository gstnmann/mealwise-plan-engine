-- =============================================================================
-- ROW LEVEL SECURITY POLICIES FOR PLAN GENERATION ENGINE
-- =============================================================================
-- Comprehensive security policies for all new tables added by the plan generation engine

-- Enable RLS on all new tables
ALTER TABLE public.usda_nutrition_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plan_generation_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.failed_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mood_jam_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.grocery_lists ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- USDA NUTRITION DATA POLICIES
-- =============================================================================

-- Allow all authenticated users to read nutrition data
-- This is public reference data needed for plan generation
CREATE POLICY "Allow authenticated users to read nutrition data"
  ON public.usda_nutrition_data
  FOR SELECT
  TO authenticated
  USING (true);

-- Only service role can modify nutrition data (for seeding scripts)
CREATE POLICY "Only service role can modify nutrition data"
  ON public.usda_nutrition_data
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- =============================================================================
-- PLAN GENERATION LOGS POLICIES
-- =============================================================================

-- Users can only see their own generation logs
CREATE POLICY "Users can view own generation logs"
  ON public.plan_generation_logs
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Only the plan generation service can insert logs
CREATE POLICY "Service role can manage generation logs"
  ON public.plan_generation_logs
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Admins can view all logs for analytics
CREATE POLICY "Admins can view all generation logs"
  ON public.plan_generation_logs
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users 
      WHERE id = auth.uid() 
      AND (email LIKE '%@mealwise.app' OR email IN ('admin@example.com'))
    )
  );

-- =============================================================================
-- FAILED PLANS POLICIES
-- =============================================================================

-- Users cannot directly access failed plans (sensitive debugging data)
-- Only service role and admins can access
CREATE POLICY "Only service role can manage failed plans"
  ON public.failed_plans
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Admins can view failed plans for debugging"
  ON public.failed_plans
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users 
      WHERE id = auth.uid() 
      AND email LIKE '%@mealwise.app'
    )
  );

-- =============================================================================
-- MOOD JAM ASSIGNMENTS POLICIES
-- =============================================================================

-- Users can view mood assignments for their own meal plans
CREATE POLICY "Users can view own mood jam assignments"
  ON public.mood_jam_assignments
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.meal_plans mp 
      WHERE mp.id = meal_plan_id 
      AND mp.user_id = auth.uid()
    )
  );

-- Users can update ratings for their own mood assignments
CREATE POLICY "Users can rate own mood jam assignments"
  ON public.mood_jam_assignments
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.meal_plans mp 
      WHERE mp.id = meal_plan_id 
      AND mp.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.meal_plans mp 
      WHERE mp.id = meal_plan_id 
      AND mp.user_id = auth.uid()
    )
  );

-- Service role can manage all mood assignments
CREATE POLICY "Service role can manage mood jam assignments"
  ON public.mood_jam_assignments
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- =============================================================================
-- GROCERY LISTS POLICIES
-- =============================================================================

-- Users can manage their own grocery lists
CREATE POLICY "Users can manage own grocery lists"
  ON public.grocery_lists
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Service role can manage all grocery lists
CREATE POLICY "Service role can manage all grocery lists"
  ON public.grocery_lists
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- =============================================================================
-- ANALYTICS VIEW POLICIES
-- =============================================================================

-- Only admins can access analytics views
CREATE POLICY "Admins can access plan generation analytics"
  ON public.plan_generation_analytics
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users 
      WHERE id = auth.uid() 
      AND email LIKE '%@mealwise.app'
    )
  );

CREATE POLICY "Admins can access nutrition accuracy stats"
  ON public.nutrition_accuracy_stats
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users 
      WHERE id = auth.uid() 
      AND email LIKE '%@mealwise.app'
    )
  );

-- =============================================================================
-- FUNCTION EXECUTION POLICIES
-- =============================================================================

-- Grant execute permissions on custom functions
GRANT EXECUTE ON FUNCTION search_nutrition_data(TEXT, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION search_nutrition_data(TEXT, INTEGER) TO service_role;

GRANT EXECUTE ON FUNCTION calculate_plan_nutrition(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION calculate_plan_nutrition(JSONB) TO service_role;

-- =============================================================================
-- ADDITIONAL SECURITY MEASURES
-- =============================================================================

-- Prevent regular users from accessing sensitive system data
REVOKE ALL ON public.failed_plans FROM authenticated;
GRANT SELECT ON public.failed_plans TO service_role;

-- Ensure nutrition data remains read-only for most operations
REVOKE INSERT, UPDATE, DELETE ON public.usda_nutrition_data FROM authenticated;
GRANT ALL ON public.usda_nutrition_data TO service_role;

COMMENT ON POLICY "Allow authenticated users to read nutrition data" ON public.usda_nutrition_data 
IS 'Public nutrition reference data needed for meal plan generation';

COMMENT ON POLICY "Users can manage own grocery lists" ON public.grocery_lists 
IS 'Users have full control over their personal grocery lists';

COMMENT ON POLICY "Only service role can manage failed plans" ON public.failed_plans 
IS 'Failed plans contain sensitive debugging data and should only be accessible to the system';