/**
 * Mood Jam Agent
 * 
 * Responsible for analyzing meal plan vibes and assigning appropriate
 * Spotify playlists. Integrates with Spotify Web API to create
 * personalized music experiences that match the meal plan's mood.
 */

import type { 
  UserBlueprint,
  GenerationContext 
} from "../types/blueprint.ts";
import type { 
  MealPlan,
  MoodJamAssignment
} from "../types/plan.ts";
import { v4 as uuidv4 } from "https://esm.sh/uuid@9";

export class MoodJamAgent {
  private supabase: any;
  private claudeApiKey: string;
  private spotifyClientId: string;
  private spotifyClientSecret: string;

  constructor(supabase: any) {
    this.supabase = supabase;
    this.claudeApiKey = Deno.env.get("ANTHROPIC_API_KEY")!;
    this.spotifyClientId = Deno.env.get("SPOTIFY_CLIENT_ID")!;
    this.spotifyClientSecret = Deno.env.get("SPOTIFY_CLIENT_SECRET")!;
  }

  /**
   * Assign mood jam (Spotify playlist) to meal plan
   */
  async assignMoodJam(
    mealPlan: MealPlan,
    context: GenerationContext
  ): Promise<{
    success: boolean;
    mood_jam?: MoodJamAssignment;
    error?: string;
    claude_requests?: number;
    tokens_used?: number;
    cost_cents?: number;
  }> {
    try {
      console.log('🎵 Analyzing meal plan mood and vibe');
      
      // Step 1: Analyze meal plan with Claude to detect mood
      const moodAnalysis = await this.analyzeMealPlanMood(mealPlan, context);
      
      if (!moodAnalysis.success) {
        return {
          success: false,
          error: moodAnalysis.error,
          claude_requests: 1,
          tokens_used: moodAnalysis.tokens_used || 0,
          cost_cents: moodAnalysis.cost_cents || 0
        };
      }
      
      // Step 2: Get Spotify access token
      const spotifyToken = await this.getSpotifyAccessToken();
      if (!spotifyToken) {
        return {
          success: false,
          error: 'Failed to authenticate with Spotify',
          claude_requests: 1,
          tokens_used: moodAnalysis.tokens_used || 0,
          cost_cents: moodAnalysis.cost_cents || 0
        };
      }
      
      // Step 3: Get playlist recommendations from Spotify
      const playlistResult = await this.getSpotifyPlaylist(
        spotifyToken,
        moodAnalysis.mood!,
        moodAnalysis.audio_features!
      );
      
      if (!playlistResult.success) {
        return {
          success: false,
          error: playlistResult.error,
          claude_requests: 1,
          tokens_used: moodAnalysis.tokens_used || 0,
          cost_cents: moodAnalysis.cost_cents || 0
        };
      }
      
      // Step 4: Create mood jam assignment
      const moodJam: MoodJamAssignment = {
        id: uuidv4(),
        meal_plan_id: mealPlan.id,
        detected_mood: moodAnalysis.mood!,
        mood_confidence: moodAnalysis.confidence!,
        mood_explanation: moodAnalysis.explanation!,
        spotify_playlist_id: playlistResult.playlist_id,
        spotify_playlist_url: playlistResult.playlist_url,
        playlist_name: playlistResult.playlist_name!,
        genres: moodAnalysis.genres || [],
        audio_features: moodAnalysis.audio_features,
        play_count: 0,
        created_at: new Date()
      };
      
      // Step 5: Save to database
      await this.saveMoodJamAssignment(moodJam);
      
      console.log(`✅ Mood jam assigned: ${moodJam.detected_mood} -> ${moodJam.playlist_name}`);
      
      return {
        success: true,
        mood_jam: moodJam,
        claude_requests: 1,
        tokens_used: moodAnalysis.tokens_used || 0,
        cost_cents: moodAnalysis.cost_cents || 0
      };
      
    } catch (error) {
      console.error('❌ Error in mood jam assignment:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Analyze meal plan mood using Claude
   */
  private async analyzeMealPlanMood(
    mealPlan: MealPlan,
    context: GenerationContext
  ): Promise<{
    success: boolean;
    mood?: string;
    confidence?: number;
    explanation?: string;
    genres?: string[];
    audio_features?: any;
    error?: string;
    tokens_used?: number;
    cost_cents?: number;
  }> {
    try {
      const prompt = this.buildMoodAnalysisPrompt(mealPlan, context);
      
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': this.claudeApiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-3-5-sonnet-20241022',
          max_tokens: 1000,
          temperature: 0.4,
          messages: [{
            role: 'user',
            content: prompt
          }]
        })
      });

      if (!response.ok) {
        throw new Error(`Claude API error: ${response.status}`);
      }

      const data = await response.json();
      const aiResponse = data.content[0].text;
      
      // Parse mood analysis response
      const analysis = this.parseMoodAnalysisResponse(aiResponse);
      
      if (!analysis.success) {
        return {
          success: false,
          error: analysis.error,
          tokens_used: data.usage?.input_tokens + data.usage?.output_tokens || 0,
          cost_cents: this.calculateCost(data.usage?.input_tokens || 0, data.usage?.output_tokens || 0)
        };
      }
      
      return {
        success: true,
        mood: analysis.mood,
        confidence: analysis.confidence,
        explanation: analysis.explanation,
        genres: analysis.genres,
        audio_features: analysis.audio_features,
        tokens_used: data.usage?.input_tokens + data.usage?.output_tokens || 0,
        cost_cents: this.calculateCost(data.usage?.input_tokens || 0, data.usage?.output_tokens || 0)
      };
      
    } catch (error) {
      return {
        success: false,
        error: `Mood analysis failed: ${error.message}`
      };
    }
  }

  /**
   * Get Spotify access token using Client Credentials flow
   */
  private async getSpotifyAccessToken(): Promise<string | null> {
    try {
      const credentials = btoa(`${this.spotifyClientId}:${this.spotifyClientSecret}`);
      
      const response = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${credentials}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: 'grant_type=client_credentials'
      });
      
      if (!response.ok) {
        console.error('Spotify auth failed:', response.status, response.statusText);
        return null;
      }
      
      const data = await response.json();
      return data.access_token;
      
    } catch (error) {
      console.error('Error getting Spotify access token:', error);
      return null;
    }
  }

  /**
   * Get playlist from Spotify based on mood and audio features
   */
  private async getSpotifyPlaylist(
    accessToken: string,
    mood: string,
    audioFeatures: any
  ): Promise<{
    success: boolean;
    playlist_id?: string;
    playlist_url?: string;
    playlist_name?: string;
    error?: string;
  }> {
    try {
      // Map mood to Spotify genre seeds
      const genreSeeds = this.mapMoodToGenres(mood);
      
      // Build Spotify recommendations request
      const params = new URLSearchParams({
        seed_genres: genreSeeds.slice(0, 5).join(','), // Max 5 seeds
        target_energy: audioFeatures.energy.toString(),
        target_valence: audioFeatures.valence.toString(),
        target_acousticness: audioFeatures.acousticness.toString(),
        target_danceability: audioFeatures.danceability.toString(),
        limit: '20'
      });
      
      const response = await fetch(`https://api.spotify.com/v1/recommendations?${params}`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      });
      
      if (!response.ok) {
        throw new Error(`Spotify recommendations failed: ${response.status}`);
      }
      
      const data = await response.json();
      
      if (!data.tracks || data.tracks.length === 0) {
        throw new Error('No tracks found for mood');
      }
      
      // For now, we'll create a virtual playlist concept
      // In a full implementation, you'd create an actual Spotify playlist
      const playlistName = this.generatePlaylistName(mood);
      
      return {
        success: true,
        playlist_id: `mealwise_${mood}_${Date.now()}`, // Virtual playlist ID
        playlist_url: `https://open.spotify.com/playlist/mealwise_${mood}`,
        playlist_name: playlistName
      };
      
    } catch (error) {
      return {
        success: false,
        error: `Spotify playlist creation failed: ${error.message}`
      };
    }
  }

  /**
   * Save mood jam assignment to database
   */
  private async saveMoodJamAssignment(moodJam: MoodJamAssignment): Promise<void> {
    try {
      const { error } = await this.supabase
        .from('mood_jam_assignments')
        .insert({
          id: moodJam.id,
          meal_plan_id: moodJam.meal_plan_id,
          detected_mood: moodJam.detected_mood,
          mood_confidence: moodJam.mood_confidence,
          spotify_playlist_id: moodJam.spotify_playlist_id,
          spotify_playlist_url: moodJam.spotify_playlist_url,
          playlist_name: moodJam.playlist_name,
          genres: moodJam.genres,
          audio_features: moodJam.audio_features,
          play_count: moodJam.play_count
        });
        
      if (error) {
        console.error('Failed to save mood jam assignment:', error);
      }
    } catch (error) {
      console.error('Error saving mood jam assignment:', error);
    }
  }

  // Helper methods
  private buildMoodAnalysisPrompt(mealPlan: MealPlan, context: GenerationContext): string {
    const planSummary = this.summarizePlanForMoodAnalysis(mealPlan);
    const userContext = this.summarizeUserContext(context.user_blueprint);
    
    return `Analyze the mood and vibe of this meal plan to assign an appropriate music playlist.

<meal_plan>
${JSON.stringify(planSummary, null, 2)}
</meal_plan>

<user_context>
${JSON.stringify(userContext, null, 2)}
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
}`;
  }

  private parseMoodAnalysisResponse(response: string): {
    success: boolean;
    mood?: string;
    confidence?: number;
    explanation?: string;
    genres?: string[];
    audio_features?: any;
    error?: string;
  } {
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      const parsed = JSON.parse(jsonMatch[0]);
      
      if (!parsed.mood || !parsed.confidence || !parsed.audio_features) {
        throw new Error('Missing required fields in mood analysis');
      }
      
      return {
        success: true,
        mood: parsed.mood,
        confidence: parsed.confidence,
        explanation: parsed.explanation || '',
        genres: parsed.genres || [],
        audio_features: parsed.audio_features
      };
      
    } catch (error) {
      return {
        success: false,
        error: `Failed to parse mood analysis: ${error.message}`
      };
    }
  }

  private mapMoodToGenres(mood: string): string[] {
    const moodGenreMap: { [mood: string]: string[] } = {
      focus: ['ambient', 'electronic', 'minimal-techno', 'study', 'chill'],
      comfort: ['folk', 'acoustic', 'indie-folk', 'singer-songwriter', 'country'],
      energy: ['pop', 'rock', 'hip-hop', 'electronic', 'dance'],
      family: ['pop', 'folk', 'classic-rock', 'soul', 'r-n-b'],
      adventure: ['world-music', 'latin', 'afrobeat', 'reggae', 'jazz'],
      zen: ['ambient', 'new-age', 'meditation', 'acoustic', 'classical']
    };
    
    return moodGenreMap[mood] || ['pop', 'acoustic', 'chill'];
  }

  private generatePlaylistName(mood: string): string {
    const playlistNames: { [mood: string]: string[] } = {
      focus: ['Mindful Meals', 'Kitchen Focus', 'Prep Zone', 'Cooking Flow'],
      comfort: ['Cozy Kitchen', 'Comfort Cooking', 'Home & Hearth', 'Soul Food Vibes'],
      energy: ['Kitchen Energy', 'Cooking Beats', 'Meal Prep Power', 'Kitchen Dance'],
      family: ['Family Feast', 'Dinner Together', 'Kitchen Gathering', 'Shared Meals'],
      adventure: ['Culinary Journey', 'Global Kitchen', 'Flavor Adventure', 'World Cuisine'],
      zen: ['Peaceful Prep', 'Mindful Kitchen', 'Zen Cooking', 'Calm Cuisine']
    };
    
    const names = playlistNames[mood] || ['Your Meal Soundtrack'];
    return names[Math.floor(Math.random() * names.length)];
  }

  private summarizePlanForMoodAnalysis(mealPlan: MealPlan): any {
    return {
      theme: mealPlan.week_theme,
      total_recipes: mealPlan.plan_data.total_recipes,
      unique_recipes: mealPlan.plan_data.unique_recipes,
      variety_score: mealPlan.plan_data.variety_score,
      day_count: mealPlan.plan_data.days.length
    };
  }

  private summarizeUserContext(blueprint: UserBlueprint): any {
    return {
      diet_type: blueprint.intake.diet_type,
      cooking_skill: blueprint.intake.cooking_skill_level,
      time_preference: blueprint.intake.cooking_time_preference,
      health_goals: blueprint.intake.health_goals,
      cultural_preferences: blueprint.intake.cultural_preferences,
      current_streak: blueprint.profile.streak_days
    };
  }

  private calculateCost(inputTokens: number, outputTokens: number): number {
    const inputCostPer1k = 0.003;
    const outputCostPer1k = 0.015;
    return Math.round(((inputTokens / 1000) * inputCostPer1k + (outputTokens / 1000) * outputCostPer1k) * 100);
  }
}