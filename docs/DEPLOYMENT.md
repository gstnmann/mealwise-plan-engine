# Mealwise Plan Generation Engine - Deployment Guide

## Overview

This guide covers deploying the Mealwise Plan Generation Engine to production using Supabase Edge Functions, with proper environment configuration, monitoring, and scaling considerations.

## Prerequisites

### Required Services
- **Supabase Project** (PostgreSQL + Edge Functions)
- **Anthropic API Key** (Claude 3.5 Sonnet access)
- **Spotify Developer Account** (Client ID + Secret)
- **Domain** (for production deployment)

### Local Development Setup
```bash
# Install Supabase CLI
npm install -g supabase

# Install dependencies
npm install

# Copy environment template
cp .env.example .env.local
```

## Environment Configuration

### Development Environment

Create `.env.local`:
```env
# Supabase Configuration
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# AI Services
ANTHROPIC_API_KEY=your_claude_api_key

# Spotify Integration
SPOTIFY_CLIENT_ID=your_spotify_client_id
SPOTIFY_CLIENT_SECRET=your_spotify_client_secret

# Optional: USDA API (for data seeding)
USDA_API_KEY=your_usda_api_key
```

### Production Environment

Set environment variables in Supabase Edge Functions:

```bash
# Set secrets via Supabase CLI
supabase secrets set ANTHROPIC_API_KEY=your_production_claude_key
supabase secrets set SPOTIFY_CLIENT_ID=your_spotify_client_id
supabase secrets set SPOTIFY_CLIENT_SECRET=your_spotify_client_secret
```

## Database Setup

### 1. Schema Deployment

```bash
# Run database migrations
psql -h db.your-project.supabase.co -U postgres -d postgres -f database/schema-additions.sql

# Apply RLS policies
psql -h db.your-project.supabase.co -U postgres -d postgres -f database/policies.sql
```

### 2. USDA Data Seeding

```bash
# Seed nutrition database (one-time setup)
node scripts/seed-usda-data.js
```

### 3. Test Data Validation

```bash
# Verify database setup
node scripts/test-generation.js
```

## Function Deployment

### 1. Initialize Supabase Functions

```bash
# Login to Supabase
supabase login

# Link to your project
supabase link --project-ref your-project-ref

# Initialize functions (if not already done)
supabase functions new plan-generator
supabase functions new ai-gateway
supabase functions new nutrition-validator
```

### 2. Deploy Functions

```bash
# Deploy all functions
supabase functions deploy plan-generator
supabase functions deploy ai-gateway
supabase functions deploy nutrition-validator

# Deploy with environment verification
supabase functions deploy plan-generator --verify-jwt false --debug
```

### 3. Test Function Deployment

```bash
# Test plan generator
curl -X POST 'https://your-project.supabase.co/functions/v1/plan-generator' \
  -H 'Authorization: Bearer your-jwt-token' \
  -H 'Content-Type: application/json' \
  -d '{}'
```

## Production Configuration

### 1. Performance Optimization

#### Supabase Settings
```sql
-- Optimize connection pooling
ALTER SYSTEM SET max_connections = 200;
ALTER SYSTEM SET shared_preload_libraries = 'pg_stat_statements';

-- Configure query performance
ALTER SYSTEM SET work_mem = '256MB';
ALTER SYSTEM SET maintenance_work_mem = '512MB';
```

#### Edge Function Optimization
```typescript
// In function code - add connection pooling
const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_ANON_KEY")!,
  {
    db: {
      schema: 'public',
    },
    auth: {
      persistSession: false, // Important for Edge Functions
    },
    global: {
      headers: { Authorization: req.headers.get("Authorization")! },
    },
  }
);
```

### 2. Rate Limiting

Implement rate limiting in your application:

```typescript
// Example rate limiting middleware
const rateLimiter = new Map();

function checkRateLimit(userId: string, limit: number = 5, window: number = 3600000) {
  const now = Date.now();
  const userRequests = rateLimiter.get(userId) || [];
  
  // Clean old requests
  const validRequests = userRequests.filter((time: number) => now - time < window);
  
  if (validRequests.length >= limit) {
    return false; // Rate limited
  }
  
  validRequests.push(now);
  rateLimiter.set(userId, validRequests);
  return true;
}
```

### 3. Error Monitoring

Set up comprehensive error tracking:

```typescript
// Enhanced error logging
const logError = async (error: Error, context: any) => {
  await supabase.from('error_logs').insert({
    error_message: error.message,
    error_stack: error.stack,
    context: JSON.stringify(context),
    timestamp: new Date().toISOString(),
    severity: 'error'
  });
};
```

## Monitoring Setup

### 1. Database Monitoring

```sql
-- Create monitoring views
CREATE VIEW performance_metrics AS
SELECT 
  DATE_TRUNC('hour', created_at) as hour,
  COUNT(*) as total_requests,
  AVG(duration_ms) as avg_duration,
  COUNT(*) FILTER (WHERE status = 'completed') as successful_requests,
  COUNT(*) FILTER (WHERE status = 'failed') as failed_requests
FROM plan_generation_logs
GROUP BY DATE_TRUNC('hour', created_at)
ORDER BY hour DESC;
```

### 2. Cost Monitoring

```sql
-- Monitor AI usage costs
CREATE VIEW ai_cost_summary AS
SELECT 
  DATE_TRUNC('day', created_at) as date,
  SUM(claude_cost_cents) as total_cost_cents,
  AVG(claude_cost_cents) as avg_cost_per_request,
  SUM(claude_tokens_used) as total_tokens
FROM plan_generation_logs
WHERE claude_cost_cents IS NOT NULL
GROUP BY DATE_TRUNC('day', created_at)
ORDER BY date DESC;
```

### 3. Health Check Endpoint

Add to your functions:

```typescript
// Health check endpoint
export async function healthCheck() {
  const checks = {
    database: false,
    claude_api: false,
    spotify_api: false
  };
  
  try {
    // Test database connection
    const { data } = await supabase.from('users').select('id').limit(1);
    checks.database = true;
    
    // Test Claude API (lightweight)
    const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'X-API-Key': Deno.env.get('ANTHROPIC_API_KEY')! },
      body: JSON.stringify({
        model: 'claude-3-haiku-20240307',
        max_tokens: 10,
        messages: [{ role: 'user', content: 'test' }]
      })
    });
    checks.claude_api = claudeResponse.ok;
    
    // Test Spotify API
    const spotifyResponse = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials'
    });
    checks.spotify_api = spotifyResponse.ok;
    
  } catch (error) {
    console.error('Health check failed:', error);
  }
  
  const allHealthy = Object.values(checks).every(Boolean);
  
  return {
    status: allHealthy ? 'healthy' : 'degraded',
    checks,
    timestamp: new Date().toISOString()
  };
}
```

## Scaling Considerations

### 1. Database Scaling

#### Read Replicas
```sql
-- For high-read workloads, consider read replicas
-- Configure in Supabase dashboard under Database > Settings
```

#### Connection Pooling
```typescript
// Use connection pooling for high-concurrency
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    db: {
      schema: 'public',
    },
    auth: {
      persistSession: false,
    },
  }
);
```

### 2. Function Scaling

Supabase Edge Functions auto-scale, but monitor:
- **Cold start times**: Optimize function initialization
- **Memory usage**: Monitor and adjust if needed
- **Execution time**: Keep under 10-minute limit

### 3. Cost Optimization

#### AI Cost Management
```typescript
// Implement intelligent caching
const responseCache = new Map();

function getCacheKey(prompt: string, model: string): string {
  return `${model}:${btoa(prompt).slice(0, 32)}`;
}

function getCachedResponse(cacheKey: string) {
  const cached = responseCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < 3600000) { // 1 hour TTL
    return cached.response;
  }
  return null;
}
```

## Security Checklist

### Pre-Production
- [ ] All environment variables set securely
- [ ] RLS policies tested and working
- [ ] API rate limiting implemented
- [ ] Input validation comprehensive
- [ ] Error messages don't leak sensitive data
- [ ] CORS configured properly
- [ ] Service role key secured

### Post-Production
- [ ] Monitor authentication failures
- [ ] Track unusual usage patterns
- [ ] Regular security updates
- [ ] Audit API access logs
- [ ] Review and rotate API keys quarterly

## Backup and Recovery

### Database Backups

Supabase handles automatic backups, but also:

```bash
# Manual backup of critical data
pg_dump -h db.your-project.supabase.co -U postgres -d postgres \
  --table=users --table=meal_plans --table=user_intake \
  > mealwise_backup_$(date +%Y%m%d).sql
```

### Function Versioning

```bash
# Tag function deployments
git tag -a v1.0.0 -m "Production deployment v1.0.0"
git push origin v1.0.0

# Deploy specific version
supabase functions deploy plan-generator --version v1.0.0
```

## Troubleshooting

### Common Issues

1. **Function Timeout**
   ```typescript
   // Add timeout handling
   const timeoutPromise = new Promise((_, reject) => 
     setTimeout(() => reject(new Error('Function timeout')), 25000)
   );
   
   const result = await Promise.race([generationPromise, timeoutPromise]);
   ```

2. **Memory Issues**
   ```typescript
   // Monitor memory usage
   const memoryUsage = Deno.memoryUsage();
   console.log('Memory usage:', Math.round(memoryUsage.heapUsed / 1024 / 1024), 'MB');
   ```

3. **Claude API Rate Limits**
   ```typescript
   // Implement exponential backoff
   async function claudeRequestWithRetry(prompt: string, maxRetries = 3) {
     for (let i = 0; i < maxRetries; i++) {
       try {
         return await callClaudeAPI(prompt);
       } catch (error) {
         if (error.status === 429 && i < maxRetries - 1) {
           await new Promise(resolve => setTimeout(resolve, Math.pow(2, i) * 1000));
           continue;
         }
         throw error;
       }
     }
   }
   ```

### Debugging Tools

```bash
# View function logs
supabase functions logs plan-generator

# Real-time log streaming
supabase functions logs plan-generator --follow

# Check function status
supabase functions list
```

## Performance Benchmarks

### Target Metrics
- **Plan Generation**: < 15 seconds (95th percentile)
- **Success Rate**: > 95%
- **AI Cost**: < $0.05 per plan
- **Database Response**: < 100ms (queries)
- **Function Cold Start**: < 2 seconds

### Load Testing

```bash
# Install artillery for load testing
npm install -g artillery

# Create load test config
cat > load-test.yml << EOF
config:
  target: 'https://your-project.supabase.co'
  phases:
    - duration: 60
      arrivalRate: 5
  defaults:
    headers:
      Authorization: 'Bearer your-test-jwt'
scenarios:
  - name: 'Generate meal plan'
    requests:
      - post:
          url: '/functions/v1/plan-generator'
          json:
            force_regenerate: true
EOF

# Run load test
artillery run load-test.yml
```

## Rollback Procedures

### Function Rollback
```bash
# List deployed versions
supabase functions list --show-versions

# Rollback to previous version
supabase functions deploy plan-generator --version previous
```

### Database Rollback
```bash
# Restore from backup if needed
psql -h db.your-project.supabase.co -U postgres -d postgres < backup_file.sql
```

This deployment guide ensures a robust, scalable, and maintainable production deployment of the Mealwise Plan Generation Engine.