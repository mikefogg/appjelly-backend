#!/usr/bin/env node

import { App, Artifact } from '#src/models/index.js';

async function checkFursonaApps() {
  try {
    const app = await App.query().findOne({ slug: 'fursona' });
    if (!app) {
      console.log('No fursona app found');
      return;
    }
    
    console.log('Fursona app:', app.id);
    
    const artifacts = await Artifact.query()
      .where('app_id', app.id)
      .orderBy('created_at', 'desc')
      .limit(5);
      
    console.log('Recent artifacts:', artifacts.map(a => ({
      id: a.id,
      title: a.title,
      status: a.status,
      created_at: a.created_at
    })));
    
    if (artifacts.length > 0) {
      console.log(`\nTest with: node scripts/generate-fursona-content.js ${artifacts[0].id}`);
    }
  } catch (error) {
    console.error('Error:', error);
  }
}

checkFursonaApps();