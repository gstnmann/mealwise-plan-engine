/**
 * USDA Nutrition Data Seeding Script
 * 
 * One-time script to populate the internal USDA nutrition database.
 * Downloads and processes USDA FoodData Central data for fast local lookups.
 * 
 * Usage: node scripts/seed-usda-data.js
 */

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import https from 'https';
import { parse } from 'csv-parse';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY // Use service role for admin operations
);

// USDA FoodData Central URLs
const USDA_URLS = {
  foundation: 'https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_foundation_food_csv_2021-10-28.zip',
  sr_legacy: 'https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_csv_2021-10-28.zip'
};

class USDASeeder {
  constructor() {
    this.processedCount = 0;
    this.errorCount = 0;
    this.batchSize = 100;
  }

  async run() {
    console.log('🌱 Starting USDA nutrition data seeding...');
    
    try {
      // Check if data already exists
      const { count } = await supabase
        .from('usda_nutrition_data')
        .select('*', { count: 'exact', head: true });
      
      if (count > 0) {
        console.log(`⚠️ Found ${count} existing records. Continue? (y/N)`);
        const readline = await import('readline');
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout
        });
        
        const answer = await new Promise(resolve => {
          rl.question('', resolve);
        });
        rl.close();
        
        if (answer.toLowerCase() !== 'y') {
          console.log('❌ Seeding cancelled');
          return;
        }
      }
      
      // Process foundation foods first (most comprehensive)
      console.log('📥 Processing Foundation Foods...');
      await this.processFoundationFoods();
      
      // Then process SR Legacy foods for additional coverage
      console.log('📥 Processing SR Legacy Foods...');
      await this.processSRLegacyFoods();
      
      console.log(`✅ Seeding completed!`);
      console.log(`📊 Processed: ${this.processedCount} records`);
      console.log(`❌ Errors: ${this.errorCount} records`);
      
    } catch (error) {
      console.error('💥 Seeding failed:', error);
      process.exit(1);
    }
  }

  async processFoundationFoods() {
    // For this demo, we'll use a curated subset of common ingredients
    // In production, you'd download and process the full USDA CSV files
    const foundationFoods = this.getFoundationFoodsSample();
    
    console.log(`Processing ${foundationFoods.length} foundation foods...`);
    
    for (let i = 0; i < foundationFoods.length; i += this.batchSize) {
      const batch = foundationFoods.slice(i, i + this.batchSize);
      await this.insertBatch(batch, 'foundation');
      
      console.log(`📈 Progress: ${Math.min(i + this.batchSize, foundationFoods.length)}/${foundationFoods.length}`);
    }
  }

  async processSRLegacyFoods() {
    const srLegacyFoods = this.getSRLegacyFoodsSample();
    
    console.log(`Processing ${srLegacyFoods.length} SR Legacy foods...`);
    
    for (let i = 0; i < srLegacyFoods.length; i += this.batchSize) {
      const batch = srLegacyFoods.slice(i, i + this.batchSize);
      await this.insertBatch(batch, 'sr_legacy');
      
      console.log(`📈 Progress: ${Math.min(i + this.batchSize, srLegacyFoods.length)}/${srLegacyFoods.length}`);
    }
  }

  async insertBatch(foods, dataType) {
    try {
      const { data, error } = await supabase
        .from('usda_nutrition_data')
        .insert(foods.map(food => ({
          fdc_id: food.fdc_id,
          description: food.description,
          calories: food.calories,
          protein: food.protein,
          fat: food.fat,
          carbohydrates: food.carbohydrates,
          fiber: food.fiber,
          sugar: food.sugar,
          nutrients: food.nutrients || {},
          data_type: dataType,
          publication_date: food.publication_date ? new Date(food.publication_date) : null
        })));
      
      if (error) {
        console.error('❌ Batch insert error:', error);
        this.errorCount += foods.length;
      } else {
        this.processedCount += foods.length;
      }
    } catch (error) {
      console.error('❌ Batch processing error:', error);
      this.errorCount += foods.length;
    }
  }

  // Sample foundation foods data (in production, load from USDA CSV)
  getFoundationFoodsSample() {
    return [
      {
        fdc_id: 746773,
        description: "Chicken, broiler or fryers, breast, skinless, boneless, meat only, raw",
        calories: 165,
        protein: 31.0,
        fat: 3.6,
        carbohydrates: 0,
        fiber: 0,
        sugar: 0,
        publication_date: '2019-04-01'
      },
      {
        fdc_id: 342522,
        description: "Beef, chuck, arm pot roast, separable lean only, trimmed to 0\" fat, choice, raw",
        calories: 124,
        protein: 20.2,
        fat: 4.3,
        carbohydrates: 0,
        fiber: 0,
        sugar: 0,
        publication_date: '2019-04-01'
      },
      {
        fdc_id: 747447,
        description: "Rice, white, long-grain, regular, raw, unenriched",
        calories: 365,
        protein: 7.1,
        fat: 0.7,
        carbohydrates: 80,
        fiber: 1.3,
        sugar: 0.1,
        publication_date: '2019-04-01'
      },
      {
        fdc_id: 170426,
        description: "Onions, raw",
        calories: 40,
        protein: 1.1,
        fat: 0.1,
        carbohydrates: 9.3,
        fiber: 1.7,
        sugar: 4.2,
        publication_date: '2019-04-01'
      },
      {
        fdc_id: 170457,
        description: "Garlic, raw",
        calories: 149,
        protein: 6.4,
        fat: 0.5,
        carbohydrates: 33,
        fiber: 2.1,
        sugar: 1.0,
        publication_date: '2019-04-01'
      },
      {
        fdc_id: 170765,
        description: "Tomatoes, red, ripe, raw, year round average",
        calories: 18,
        protein: 0.9,
        fat: 0.2,
        carbohydrates: 3.9,
        fiber: 1.2,
        sugar: 2.6,
        publication_date: '2019-04-01'
      },
      {
        fdc_id: 170417,
        description: "Carrots, raw",
        calories: 41,
        protein: 0.9,
        fat: 0.2,
        carbohydrates: 9.6,
        fiber: 2.8,
        sugar: 4.7,
        publication_date: '2019-04-01'
      },
      {
        fdc_id: 168462,
        description: "Salmon, Atlantic, farmed, raw",
        calories: 208,
        protein: 20.4,
        fat: 12.4,
        carbohydrates: 0,
        fiber: 0,
        sugar: 0,
        publication_date: '2019-04-01'
      },
      {
        fdc_id: 171287,
        description: "Milk, reduced fat, fluid, 2% milkfat, with added vitamin A and vitamin D",
        calories: 50,
        protein: 3.3,
        fat: 2.0,
        carbohydrates: 4.8,
        fiber: 0,
        sugar: 4.8,
        publication_date: '2019-04-01'
      },
      {
        fdc_id: 173410,
        description: "Eggs, Grade A, Large, egg whole",
        calories: 155,
        protein: 13.0,
        fat: 11.0,
        carbohydrates: 1.1,
        fiber: 0,
        sugar: 1.1,
        publication_date: '2019-04-01'
      },
      {
        fdc_id: 170890,
        description: "Spinach, raw",
        calories: 23,
        protein: 2.9,
        fat: 0.4,
        carbohydrates: 3.6,
        fiber: 2.2,
        sugar: 0.4,
        publication_date: '2019-04-01'
      },
      {
        fdc_id: 168409,
        description: "Sweet potato, raw, unprepared",
        calories: 86,
        protein: 1.6,
        fat: 0.1,
        carbohydrates: 20.1,
        fiber: 3.0,
        sugar: 4.2,
        publication_date: '2019-04-01'
      },
      {
        fdc_id: 170178,
        description: "Broccoli, raw",
        calories: 34,
        protein: 2.8,
        fat: 0.4,
        carbohydrates: 6.6,
        fiber: 2.6,
        sugar: 1.5,
        publication_date: '2019-04-01'
      },
      {
        fdc_id: 169962,
        description: "Avocados, raw, all commercial varieties",
        calories: 160,
        protein: 2.0,
        fat: 14.7,
        carbohydrates: 8.5,
        fiber: 6.7,
        sugar: 0.7,
        publication_date: '2019-04-01'
      },
      {
        fdc_id: 175167,
        description: "Quinoa, uncooked",
        calories: 368,
        protein: 14.1,
        fat: 6.1,
        carbohydrates: 64.2,
        fiber: 7.0,
        sugar: 4.6,
        publication_date: '2019-04-01'
      },
      {
        fdc_id: 170567,
        description: "Beans, black, mature seeds, raw",
        calories: 341,
        protein: 21.6,
        fat: 1.4,
        carbohydrates: 62.4,
        fiber: 15.5,
        sugar: 2.1,
        publication_date: '2019-04-01'
      },
      {
        fdc_id: 167762,
        description: "Almonds, raw",
        calories: 579,
        protein: 21.2,
        fat: 49.9,
        carbohydrates: 21.6,
        fiber: 12.5,
        sugar: 4.4,
        publication_date: '2019-04-01'
      },
      {
        fdc_id: 170419,
        description: "Bell peppers, red, raw",
        calories: 31,
        protein: 1.0,
        fat: 0.3,
        carbohydrates: 7.3,
        fiber: 2.5,
        sugar: 4.2,
        publication_date: '2019-04-01'
      },
      {
        fdc_id: 171330,
        description: "Cheese, cheddar",
        calories: 403,
        protein: 24.9,
        fat: 33.1,
        carbohydrates: 1.3,
        fiber: 0,
        sugar: 0.5,
        publication_date: '2019-04-01'
      },
      {
        fdc_id: 168917,
        description: "Olive oil, extra virgin",
        calories: 884,
        protein: 0,
        fat: 100,
        carbohydrates: 0,
        fiber: 0,
        sugar: 0,
        publication_date: '2019-04-01'
      }
    ];
  }

  // Sample SR Legacy foods data
  getSRLegacyFoodsSample() {
    return [
      {
        fdc_id: 168462,
        description: "Fish, salmon, Atlantic, farmed, cooked, dry heat",
        calories: 231,
        protein: 25.4,
        fat: 13.4,
        carbohydrates: 0,
        fiber: 0,
        sugar: 0,
        publication_date: '2019-04-01'
      },
      {
        fdc_id: 169094,
        description: "Pasta, cooked, unenriched, without added salt",
        calories: 131,
        protein: 5.0,
        fat: 1.1,
        carbohydrates: 25.0,
        fiber: 1.8,
        sugar: 0.6,
        publication_date: '2019-04-01'
      },
      {
        fdc_id: 170073,
        description: "Potatoes, flesh and skin, raw",
        calories: 77,
        protein: 2.0,
        fat: 0.1,
        carbohydrates: 17.5,
        fiber: 2.2,
        sugar: 0.8,
        publication_date: '2019-04-01'
      },
      {
        fdc_id: 172421,
        description: "Yogurt, plain, low fat, 12 grams protein per 8 ounce",
        calories: 63,
        protein: 5.3,
        fat: 1.6,
        carbohydrates: 7.0,
        fiber: 0,
        sugar: 7.0,
        publication_date: '2019-04-01'
      },
      {
        fdc_id: 169417,
        description: "Bananas, raw",
        calories: 89,
        protein: 1.1,
        fat: 0.3,
        carbohydrates: 22.8,
        fiber: 2.6,
        sugar: 12.2,
        publication_date: '2019-04-01'
      }
    ];
  }
}

// Run the seeding script
if (import.meta.url === `file://${process.argv[1]}`) {
  const seeder = new USDASeeder();
  seeder.run().catch(console.error);
}

export default USDASeeder;