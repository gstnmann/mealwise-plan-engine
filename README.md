# 🥗 Mealwise Plan Generation Engine - Complete Implementation Guide

> The definitive execution blueprint for the Mealwise Plan Generation Engine, built for scale and incorporating all strategic decisions and first-principle refinements.

## 🎯 **Mission Statement**

This engine transforms a user's unique **Blueprint** (profile, goals, preferences) into a nutritionally sound, delightful, and highly personalized weekly meal plan. It embodies the core of the **M.I.O.L. (Mealwise Intelligent Orchestration Layer)**.

## 🏗️ **Architecture Overview**

- **Execution Environment**: Supabase Edge Functions
- **Database**: PostgreSQL (Supabase) with Row Level Security
- **AI Engine**: Claude 3.5 Sonnet via Anthropic SDK
- **Nutrition Validation**: Internal USDA database (cached for speed)
- **Music Integration**: Spotify API for Mood Jam assignments

## 📂 **Implementation Structure**

```
meal-plan-engine/
├── README.md                     # This guide
├── database/
│   ├── schema-additions.sql      # New tables for USDA data
│   ├── functions.sql             # Database helper functions
│   └── policies.sql              # RLS security policies
├── supabase/
│   └── functions/
│       ├── plan-generator/       # Main generation engine
│       ├── ai-gateway/           # AI request routing & validation
│       └── nutrition-validator/   # USDA integration logic
├── agents/
│   ├── candidate-selector.ts     # Recipe filtering & AI scoring
│   ├── nutrition-council.ts      # Validation & refinement
│   ├── wow-layer.ts             # Experience augmentation
│   └── mood-jam.ts              # Spotify playlist assignment
├── prompts/
│   ├── plan-generator.md         # Main generation prompt
│   ├── nutrition-council.md      # Validation prompts
│   └── scoring-agent.md          # Recipe scoring prompts
├── types/
│   ├── blueprint.ts              # User profile interfaces
│   ├── recipe.ts                # Recipe & nutrition types
│   └── plan.ts                  # Meal plan structures
├── scripts/
│   ├── seed-usda-data.js         # One-time USDA database seeding
│   └── test-generation.js       # End-to-end testing script
└── docs/
    ├── API.md                    # API documentation
    ├── DEPLOYMENT.md             # Deployment guide
    └── TESTING.md                # Testing strategy
```

## 🔄 **Generation Flow**

### **Stage 0: Secure Validation**
- ✅ Authentication via Supabase Auth
- ✅ Subscription tier verification
- ✅ Request validation with Zod schemas

### **Stage 1: Blueprint Ingestion**
- ✅ Fetch complete user profile from `user_intake`
- ✅ Aggregate preferences, restrictions, goals
- ✅ Calculate nutritional targets

### **Stage 2: Intelligent Candidate Selection**
- ✅ **SQL Filtering**: Hard constraints (allergies, diet type)
- ✅ **AI Scoring**: Claude-powered personalization ranking
- ✅ **Premium Access**: Gamification-based recipe access

### **Stage 3: AI Nutrition Council**
- ✅ **Circuit Breaker**: Max 3 generation attempts
- ✅ **Nutritional Validation**: Internal USDA database
- ✅ **Coherence Review**: Claude taste/variety assessment
- ✅ **Graceful Fallback**: Simplified backup plans

### **Stage 4: "Wow" Layer Enhancement**
- ✅ Smart grocery list generation
- ✅ Prep-ahead scheduling
- ✅ Mood jam assignment (Spotify)
- ✅ XP challenge integration

### **Stage 5: Serialization & Storage**
- ✅ Structured JSON generation
- ✅ Database storage with versioning
- ✅ Event tracking for analytics

## 🚀 **Quick Start**

### **1. Database Setup**
```bash
# Run schema additions
psql -h your-supabase-host -U postgres -d postgres -f database/schema-additions.sql

# Seed USDA nutrition data (one-time)
node scripts/seed-usda-data.js
```

### **2. Deploy Supabase Functions**
```bash
# Deploy all functions
supabase functions deploy plan-generator
supabase functions deploy ai-gateway
supabase functions deploy nutrition-validator
```

### **3. Environment Variables**
```env
# Required in Supabase Edge Function environment
ANTHROPIC_API_KEY=your_claude_api_key
SPOTIFY_CLIENT_ID=your_spotify_client_id
SPOTIFY_CLIENT_SECRET=your_spotify_client_secret
USDA_API_KEY=your_usda_api_key  # For initial seeding only
```

### **4. Test the Engine**
```bash
# End-to-end test
node scripts/test-generation.js
```

## 🔐 **Security Features**

- **Row Level Security**: All database access controlled by RLS policies
- **Input Validation**: Zod schemas for all API inputs
- **AI Gateway**: Sanitized and validated LLM requests
- **Rate Limiting**: Built-in protection against abuse
- **Error Handling**: Graceful fallbacks with detailed logging

## 📊 **Monitoring & Analytics**

- **Generation Success Rate**: Tracked per user and globally
- **Performance Metrics**: Response times and resource usage
- **User Satisfaction**: Plan ratings and completion rates
- **Nutritional Accuracy**: Deviation from targets
- **AI Usage**: Token consumption and cost tracking

## 🎯 **Key Features**

### **Intelligent Recipe Selection**
- Multi-stage filtering with hard constraints
- Claude-powered personalization scoring
- Premium content access based on gamification

### **Nutritional Integrity**
- 15% macro deviation threshold validation
- Internal USDA database for ground-truth data
- Smart variety rules with user override support

### **Experience Enhancement**
- Spotify playlist assignment based on meal vibes
- Smart grocery lists with quantity aggregation
- Prep-ahead scheduling for efficiency
- XP challenge integration for gamification

### **Scalability & Reliability**
- Circuit breaker pattern for AI calls
- Graceful fallback mechanisms
- Async processing ready (v2)
- Comprehensive error handling

## 📈 **Performance Targets**

- **Generation Time**: < 10 seconds (synchronous)
- **Success Rate**: > 95% for valid user profiles
- **Nutritional Accuracy**: Within 15% of macro targets
- **User Satisfaction**: > 4.0/5.0 average rating

## 🔧 **Development Workflow**

1. **Local Development**: Use Supabase CLI for local testing
2. **Testing**: Comprehensive unit and integration tests
3. **Staging**: Deploy to staging environment first
4. **Production**: Blue-green deployment with rollback capability

## 📚 **Documentation Links**

- [API Documentation](docs/API.md)
- [Deployment Guide](docs/DEPLOYMENT.md)
- [Testing Strategy](docs/TESTING.md)
- [Architecture Deep Dive](docs/ARCHITECTURE.md)

---

**Built with ❤️ and Claude AI for the Mealwise Platform**

*Ready to transform meal planning with intelligence, personalization, and joy.*