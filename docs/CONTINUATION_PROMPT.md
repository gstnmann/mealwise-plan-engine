# 🚀 MEALWISE PLAN GENERATION ENGINE - CONTINUATION PROMPT

> **Use this prompt to continue the Mealwise implementation in a new Claude chat if the current chat reaches length limits.**

---

I'm building the **Mealwise Plan Generation Engine** - a complete meal planning system with Claude AI integration. I have a comprehensive implementation with database schemas, API endpoints, agents, and documentation already built, but need to complete the remaining components.

## 🎯 **Current Status**

**✅ COMPLETED COMPONENTS:**
- Database schema with USDA nutrition tables, RLS policies, and analytics views
- Complete TypeScript type definitions for all interfaces
- Main plan generator Supabase Edge Function with authentication and validation
- Candidate Selector Agent (recipe filtering + AI scoring)
- Nutrition Council Agent (validation with internal USDA database)
- Wow Layer Agent (grocery lists, prep schedules, XP challenges)
- Mood Jam Agent (Spotify playlist integration)
- USDA data seeding script and comprehensive testing utilities
- Full API documentation and deployment guide
- All structured Claude prompts for different operations

**❌ REMAINING COMPONENTS TO BUILD:**
1. **AI Gateway Function** (`supabase/functions/ai-gateway/index.ts`)
2. **Nutrition Validator Function** (`supabase/functions/nutrition-validator/index.ts`) 
3. **Additional utility scripts** (performance monitoring, data migration)
4. **Frontend integration examples** (React hooks, TypeScript clients)
5. **Testing and validation scripts** for production readiness
6. **Advanced features** (meal swapping, plan optimization, analytics dashboards)

## 🏗️ **System Architecture Overview**

**Tech Stack:**
- **Backend**: Supabase (PostgreSQL + Edge Functions)
- **AI**: Claude 3.5 Sonnet via Anthropic API
- **Nutrition**: Internal USDA FoodData Central database (cached for speed)
- **Music**: Spotify Web API integration
- **Types**: Complete TypeScript definitions

**Generation Flow:**
1. **Stage 0**: Secure validation (auth, subscription, input validation)
2. **Stage 1**: Blueprint ingestion (user profile + preferences + targets)
3. **Stage 2**: Candidate selection (SQL filtering + Claude scoring)
4. **Stage 3**: AI Nutrition Council (validation + refinement with circuit breaker)
5. **Stage 4**: Wow layer enhancement (grocery lists + mood jams + XP challenges)
6. **Stage 5**: Serialization & storage

**Key Features:**
- ✅ Nutritional validation with 15% macro deviation threshold
- ✅ Smart variety rules with user override support
- ✅ Spotify playlist assignment based on meal plan vibes
- ✅ Comprehensive error handling with graceful fallbacks
- ✅ Performance tracking and cost monitoring
- ✅ Circuit breaker pattern for reliability

## 📋 **IMMEDIATE TASKS**

### **Task 1: AI Gateway Function**
Create `supabase/functions/ai-gateway/index.ts` with:
- Secure Claude API request routing
- Input sanitization and validation
- Rate limiting per user
- Cost tracking and logging
- Response caching for efficiency
- Error handling with fallbacks

### **Task 2: Nutrition Validator Function**
Create `supabase/functions/nutrition-validator/index.ts` with:
- USDA database integration for ingredient lookup
- Meal plan nutrition calculation
- Macro target comparison and deviation analysis
- Suggestion generation for improvements
- Batch processing for efficiency

### **Task 3: Production Utilities**
Create additional scripts:
- Performance monitoring dashboard
- Data migration utilities
- Production health checks
- Cost optimization tools

### **Task 4: Frontend Integration**
Create React hooks and TypeScript clients:
- `useMealPlanGeneration` hook
- `MealPlanClient` class
- Error handling patterns
- Loading state management

## 🎛️ **Implementation Guidelines**

**Follow the established patterns:**
- ✅ All functions use Zod validation
- ✅ Comprehensive error handling with structured responses
- ✅ Performance logging to `plan_generation_logs`
- ✅ RLS security policies for data access
- ✅ TypeScript interfaces for all data structures
- ✅ Circuit breaker patterns for external API calls
- ✅ Cost tracking for all AI operations

**Security Requirements:**
- ✅ All sensitive routes protected by Supabase Auth
- ✅ Input sanitization with DOMPurify for user content
- ✅ Rate limiting implementation
- ✅ No localStorage/sessionStorage in artifacts
- ✅ Service role access for admin operations only

**Code Style:**
- ✅ TypeScript with strict types
- ✅ Comprehensive error messages
- ✅ Console logging for debugging
- ✅ Modular, testable functions
- ✅ Clear documentation and comments

## 🔧 **Environment Context**

**Required Environment Variables:**
```env
SUPABASE_URL=https://project.supabase.co
SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_key
ANTHROPIC_API_KEY=your_claude_key
SPOTIFY_CLIENT_ID=your_spotify_id
SPOTIFY_CLIENT_SECRET=your_spotify_secret
```

**Database Tables:**
- ✅ `users`, `user_intake`, `subscriptions`, `meal_plans`
- ✅ `recipes`, `usda_nutrition_data`, `plan_generation_logs`
- ✅ `mood_jam_assignments`, `grocery_lists`, `failed_plans`

## 📚 **Implementation References**

**Existing Code Patterns:**
- See main plan generator for authentication flow
- See candidate selector for Claude API integration
- See nutrition council for USDA database usage
- See wow layer for multi-agent coordination
- See mood jam for Spotify API integration

**Key Functions to Reference:**
- `logGenerationEvent()` for performance tracking
- `validateUserBlueprint()` for input validation
- `calculateCost()` for AI cost tracking
- `search_nutrition_data()` for USDA lookup

## 🎯 **SUCCESS CRITERIA**

When complete, the system should:
- ✅ Generate meal plans in < 15 seconds
- ✅ Achieve > 95% success rate
- ✅ Stay within 15% of nutritional targets
- ✅ Handle graceful fallbacks for edge cases
- ✅ Track all costs and performance metrics
- ✅ Provide comprehensive error messages
- ✅ Scale to thousands of concurrent users

---

**Please continue building the remaining components following the established architecture, patterns, and guidelines. Focus on production-ready code with comprehensive error handling, performance tracking, and security.**

**Start with the AI Gateway function, then move to the Nutrition Validator, and finally the production utilities and frontend integration.**